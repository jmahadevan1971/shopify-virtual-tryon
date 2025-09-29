// Virtual Try-On Server for Shopify
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const bodyParser = require('body-parser');
require('dotenv').config();

const app = express();

// Multer configuration for file uploads
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { 
    fileSize: 15 * 1024 * 1024, // 15MB limit
    files: 2
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPEG, PNG and WebP are allowed.'));
    }
  }
});

// Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Token'],
  credentials: true
}));
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));

// Request logging middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    service: 'Shopify Virtual Try-On API',
    version: '1.0.0',
    status: 'running',
    endpoints: {
      health: '/health',
      tryon: '/api/tryon/generate'
    },
    documentation: 'https://github.com/jmahadevan1971/shopify-virtual-tryon'
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK',
    service: 'Virtual Try-On API',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage()
  });
});

// Virtual Try-On Processing Class
class VirtualTryOnProcessor {
  async processImages(personBuffer, dressBuffer) {
    try {
      // Load images
      const personImage = sharp(personBuffer);
      const dressImage = sharp(dressBuffer);
      
      // Get metadata
      const personMeta = await personImage.metadata();
      const dressMeta = await dressImage.metadata();
      
      // Calculate dimensions for dress overlay
      const dressWidth = Math.floor(personMeta.width * 0.6);
      const dressHeight = Math.floor((dressMeta.height / dressMeta.width) * dressWidth);
      const dressX = Math.floor((personMeta.width - dressWidth) / 2);
      const dressY = Math.floor(personMeta.height * 0.18);
      
      // Process dress image
      const processedDress = await dressImage
        .resize(dressWidth, dressHeight, {
          fit: 'contain',
          background: { r: 0, g: 0, b: 0, alpha: 0 }
        })
        .png()
        .toBuffer();
      
      // Create white overlay to "remove" original clothes
      const whiteOverlay = await sharp({
        create: {
          width: Math.floor(dressWidth * 0.9),
          height: Math.floor(dressHeight * 0.8),
          channels: 4,
          background: { r: 255, g: 255, b: 255, alpha: 0.7 }
        }
      }).png().toBuffer();
      
      // Composite layers
      const result = await personImage
        .composite([
          {
            input: whiteOverlay,
            top: dressY + 20,
            left: dressX + Math.floor(dressWidth * 0.05),
            blend: 'over'
          },
          {
            input: processedDress,
            top: dressY,
            left: dressX,
            blend: 'over'
          }
        ])
        .jpeg({ quality: 95, progressive: true })
        .toBuffer();
      
      return result;
    } catch (error) {
      console.error('Processing error:', error);
      throw error;
    }
  }
}

const processor = new VirtualTryOnProcessor();

// Main virtual try-on endpoint
app.post('/api/tryon/generate', 
  upload.fields([
    { name: 'person', maxCount: 1 },
    { name: 'dress', maxCount: 1 }
  ]), 
  async (req, res) => {
    const startTime = Date.now();
    
    try {
      console.log('Processing virtual try-on request...');
      
      // Validate input
      if (!req.files || !req.files['person'] || !req.files['dress']) {
        return res.status(400).json({
          success: false,
          error: 'Both person and dress images are required',
          required: ['person', 'dress']
        });
      }

      const personBuffer = req.files['person'][0].buffer;
      const dressBuffer = req.files['dress'][0].buffer;
      
      console.log(`Processing images - Person: ${req.files['person'][0].size} bytes, Dress: ${req.files['dress'][0].size} bytes`);
      
      // Process images
      const result = await processor.processImages(personBuffer, dressBuffer);
      
      // Convert to base64
      const resultBase64 = `data:image/jpeg;base64,${result.toString('base64')}`;
      
      const processingTime = Date.now() - startTime;
      console.log(`Virtual try-on completed in ${processingTime}ms`);
      
      res.json({
        success: true,
        result: resultBase64,
        metadata: {
          processingTime: `${processingTime}ms`,
          resultSize: result.length,
          timestamp: new Date().toISOString()
        },
        message: 'Virtual try-on generated successfully'
      });
      
    } catch (error) {
      console.error('Error in /api/tryon/generate:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to process virtual try-on',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    availableEndpoints: {
      health: '/health',
      tryon: '/api/tryon/generate'
    }
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Server error:', error);
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    message: error.message
  });
});

// Start server
const PORT = process.env.PORT || 3001;
const server = app.listen(PORT, () => {
  console.log('========================================');
  console.log(`🚀 Virtual Try-On Server Started`);
  console.log(`📍 Port: ${PORT}`);
  console.log(`🔗 Health: http://localhost:${PORT}/health`);
  console.log(`📝 API: http://localhost:${PORT}/api/tryon/generate`);
  console.log('========================================');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

module.exports = app;
