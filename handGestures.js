class HandGestures {
  constructor(options = {}) {
    // Create internal elements
    this.video = document.createElement('video');
    this.video.setAttribute('playsinline', '');
    this.video.style.display = 'none'; // Hidden by default
    this.video.style.position = 'absolute';
    this.video.style.top = '0';
    this.video.style.left = '0';
    this.video.style.width = '100%';
    this.video.style.height = '100%';

    this.canvas = document.createElement('canvas');
    this.canvas.width = options.width || 800;
    this.canvas.height = options.height || 600;
    this.canvas.style.display = 'none'; // Hidden by default
    this.canvas.style.position = 'absolute';
    this.canvas.style.top = '0';
    this.canvas.style.left = '0';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    

    this.canvasCtx = null;
    
    // MediaPipe objects
    this.hands = null;
    this.camera = null;
    this.stream = null;
    
    // Gesture state
    this.isPinching = false;
    this.pinchStartX = 0;
    this.pinchStartY = 0;
    this.pinchDragX = 0; // Now stores percentage of canvas width
    this.pinchDragY = 0; // Now stores percentage of canvas height
    this.isFist = false;
    this.fistStartX = 0;
    this.fistStartY = 0;
    this.fistDragX = 0; // Now stores percentage of canvas width
    this.fistDragY = 0; // Now stores percentage of canvas height
    this.thumbIndexDistance = 0;
    this.handDetected = false;
    
    // Settings with defaults
    this.settings = {
      pinchThreshold: options.pinchThreshold || 35,
      fistThreshold: options.fistThreshold || 0.6,
      maxNumHands: options.maxNumHands || 1,
      modelComplexity: options.modelComplexity || 1,
      minDetectionConfidence: options.minDetectionConfidence || 0.9,
      minTrackingConfidence: options.minTrackingConfidence || 0.9,
      flipHorizontal: options.flipHorizontal !== undefined ? options.flipHorizontal : true,
      smoothingFactor: options.smoothingFactor || 0.8,
      moveMode: options.moveMode || 'relative', // 'absolute' | 'relative'
      width: options.width || 800,
      height: options.height || 600
    };
    
    // Event system
    this.events = {
      listeners: {},
      on: (event, callback) => {
        if (!this.events.listeners[event]) {
          this.events.listeners[event] = [];
        }
        this.events.listeners[event].push(callback);
      },
      off: (event, callback) => {
        if (this.events.listeners[event]) {
          this.events.listeners[event] = this.events.listeners[event].filter(cb => cb !== callback);
        }
      },
      emit: (event, ...args) => {
        if (this.events.listeners[event]) {
          this.events.listeners[event].forEach(callback => callback(...args));
        }
      }
    };
    
    // Append elements to document body if needed
    if (options.appendToBody) {
      document.body.appendChild(this.video);
      document.body.appendChild(this.canvas);
    }
    
    // Bind the onResults method to the class instance
    this.onResults = this.onResults.bind(this);
  }
  
  // Methods to get the internal elements
  getVideoElement() {
    return this.video;
  }
  
  getCanvasElement() {
    return this.canvas;
  }
  
  // Show/hide visualization elements
  showVisualization() {
    this.canvas.style.display = 'block';
    return this;
  }
  
  hideVisualization() {
    this.canvas.style.display = 'none';
    return this;
  }
  
  // Attach elements to a container in the DOM
  attachTo(container) {
    if (container instanceof HTMLElement) {
      // Remove from current parent if any
      if (this.video.parentNode) {
        this.video.parentNode.removeChild(this.video);
      }
      if (this.canvas.parentNode) {
        this.canvas.parentNode.removeChild(this.canvas);
      }
      
      // Append to new container
      container.appendChild(this.video);
      container.appendChild(this.canvas);

      // show video
      this.video.style.display = 'block';

      return true;
    }
    return false;
  }
  
  async init() {
    try {
      // Initialize canvas context
      this.canvasCtx = this.canvas.getContext('2d');
      this.updateCanvasSize();
      
      // Initialize MediaPipe Hands
      this.hands = new Hands({
        locateFile: (file) => {
          return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
        }
      });
      
      this.hands.setOptions({
        maxNumHands: this.settings.maxNumHands,
        modelComplexity: this.settings.modelComplexity,
        minDetectionConfidence: this.settings.minDetectionConfidence,
        minTrackingConfidence: this.settings.minTrackingConfidence,
        flipHorizontal: this.settings.flipHorizontal
      });
      
      this.hands.onResults(this.onResults);
      
      return true;
    } catch (error) {
      console.error('Error initializing HandGestures:', error);
      return false;
    }
  }
  
  async start() {
    try {
      // Only request camera access when explicitly starting
      this.stream = await navigator.mediaDevices.getUserMedia({ 
        video: { width: this.canvas.width, height: this.canvas.height } 
      });
      
      this.video.srcObject = this.stream;
      
      // Manually start video playback - no autoplay
      await this.video.play();
      
      this.camera = new Camera(this.video, {
        onFrame: async () => {
          await this.hands.send({ image: this.video });
        }
      });
      
      await this.camera.start();
      this.events.emit('started');
      return true;
    } catch (error) {
      console.error('Error starting hand tracking:', error);
      this.events.emit('error', error);
      return false;
    }
  }
  
  stop() {
    if (this.camera) {
      this.camera.stop();
      this.camera = null;
    }
    
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    
    this.isPinching = false;
    this.pinchStartX = 0;
    this.pinchStartY = 0;
    this.pinchDragX = 0; // Reset percentage value
    this.pinchDragY = 0; // Reset percentage value
    this.isFist = false;
    this.fistStartX = 0;
    this.fistStartY = 0;
    this.fistDragX = 0; // Reset percentage value
    this.fistDragY = 0; // Reset percentage value
    
    this.events.emit('stopped');
    return true;
  }
  
  updateCanvasSize() {
    if (this.settings.width && this.settings.height) {
      this.canvas.width = this.settings.width;
      this.canvas.height = this.settings.height;
    } else {
      this.canvas.width = this.canvas.clientWidth || 800;
      this.canvas.height = this.canvas.clientHeight || 600;
    }
  }
  
  onResults(results) {
    if (!this.canvasCtx) return;
    
    this.canvasCtx.save();
    this.canvasCtx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    
    this.thumbIndexDistance = 0;
    this.handDetected = false;
    
    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0 && results.multiHandedness) {
      const landmarks = results.multiHandLandmarks[0];
      
      // Draw hand landmarks
      // drawConnectors(this.canvasCtx, landmarks, Hands.HAND_CONNECTIONS, { color: '#00FF00', lineWidth: 2 });
      // drawLandmarks(this.canvasCtx, landmarks, { color: '#FF0000', radius: 2 });
      
      this.handDetected = true;

      const sm = this.settings.smoothingFactor;
      
      // Extract hand landmarks
      const thumbTip = landmarks[4];
      const indexTip = landmarks[8];
      const middleTip = landmarks[12];
      const ringTip = landmarks[16];
      const pinkyTip = landmarks[20];
      const wrist = landmarks[0];
      
      // Convert normalized coordinates to canvas coordinates
      const thumbX = thumbTip.x * this.canvas.width;
      const thumbY = thumbTip.y * this.canvas.height;
      const indexX = indexTip.x * this.canvas.width;
      const indexY = indexTip.y * this.canvas.height;
      const middleX = middleTip.x * this.canvas.width;
      const middleY = middleTip.y * this.canvas.height;
      const ringX = ringTip.x * this.canvas.width;
      const ringY = ringTip.y * this.canvas.height;
      const pinkyX = pinkyTip.x * this.canvas.width;
      const pinkyY = pinkyTip.y * this.canvas.height;
      const wristX = wrist.x * this.canvas.width;
      const wristY = wrist.y * this.canvas.height;
      
      // Calculate pinch distance
      this.thumbIndexDistance = Math.sqrt(
        Math.pow(indexX - thumbX, 2) + Math.pow(indexY - thumbY, 2)
      );
      
      // Previous state tracking for events
      const wasPinching = this.isPinching;
      const wasFist = this.isFist;
      
      // Pinch detection
      if (this.thumbIndexDistance < this.settings.pinchThreshold && !this.isPinching) {
        this.isPinching = true;
        this.pinchStartX = indexX;
        this.pinchStartY = indexY;
        
        // Reset smoothing buffer in absolute mode for immediate response
        if (this.settings.moveMode === 'absolute') {
          this.pinchDragX = (indexX / this.canvas.width) * 100;
          this.pinchDragY = (indexY / this.canvas.height) * 100;
        }
        
        this.events.emit('pinch', true);
      } else if (this.thumbIndexDistance >= this.settings.pinchThreshold && this.isPinching) {
        this.isPinching = false;
        this.pinchStartX = 0;
        this.pinchStartY = 0;
        this.pinchDragX = 0;
        this.pinchDragY = 0;
        this.events.emit('pinch', false);
      }
      
      // Fist detection - check if all fingertips are close to the palm
      const fingerTipDistances = [
        Math.sqrt(Math.pow(indexX - wristX, 2) + Math.pow(indexY - wristY, 2)),
        Math.sqrt(Math.pow(middleX - wristX, 2) + Math.pow(middleY - wristY, 2)),
        Math.sqrt(Math.pow(ringX - wristX, 2) + Math.pow(ringY - wristY, 2)),
        Math.sqrt(Math.pow(pinkyX - wristX, 2) + Math.pow(pinkyY - wristY, 2))
      ];
      
      // Calculate average distance between fingertips and wrist
      const avgFingerDistance = fingerTipDistances.reduce((sum, dist) => sum + dist, 0) / fingerTipDistances.length;
      
      // Calculate distance between thumb and wrist
      const thumbWristDistance = Math.sqrt(Math.pow(thumbX - wristX, 2) + Math.pow(thumbY - wristY, 2));
      
      // Detect fist when fingers are curled
      const isFistDetected = avgFingerDistance < thumbWristDistance * this.settings.fistThreshold;
      
      if (isFistDetected && !this.isFist) {
        this.isFist = true;
        this.fistStartX = wristX;
        this.fistStartY = wristY;
        
        // Reset smoothing buffer in absolute mode for immediate response
        if (this.settings.moveMode === 'absolute') {
          this.fistDragX = (wristX / this.canvas.width) * 100;
          this.fistDragY = (wristY / this.canvas.height) * 100;
        }
        
        this.events.emit('fist', true);
      } else if (!isFistDetected && this.isFist) {
        this.isFist = false;
        this.fistStartX = 0;
        this.fistStartY = 0;
        this.fistDragX = 0;
        this.fistDragY = 0;
        this.events.emit('fist', false);
      }
      
      // Highlight thumb and index finger when pinching
      if (this.isPinching) {
        this.canvasCtx.fillStyle = '#00FF00';
        this.canvasCtx.beginPath();
        this.canvasCtx.arc(thumbX, thumbY, 8, 0, 2 * Math.PI);
        this.canvasCtx.fill();
        
        this.canvasCtx.beginPath();
        this.canvasCtx.arc(indexX, indexY, 8, 0, 2 * Math.PI);
        this.canvasCtx.fill();
        
        // Calculate drag with smoothing (as percentage of canvas dimensions)
        let newPinchDragX, newPinchDragY;
        
        if (this.settings.moveMode === 'absolute') {
          // Absolute mode: current position as percentage of canvas
          newPinchDragX = (indexX / this.canvas.width) * 100;
          newPinchDragY = (indexY / this.canvas.height) * 100;
        } else {
          // Relative mode: movement from start position (inverted for intuitive direction)
          newPinchDragX = -((indexX - this.pinchStartX) / this.canvas.width) * 100;
          newPinchDragY = -((indexY - this.pinchStartY) / this.canvas.height) * 100;
        }

        this.pinchDragX = sm * this.pinchDragX + (1 - sm) * newPinchDragX;
        this.pinchDragY = sm * this.pinchDragY + (1 - sm) * newPinchDragY;
      }
      
      // Highlight fist when detected
      if (this.isFist) {
        // Draw a circle around the hand
        this.canvasCtx.strokeStyle = '#FFFF00';
        this.canvasCtx.lineWidth = 3;
        this.canvasCtx.beginPath();
        this.canvasCtx.arc(wristX, wristY, 50, 0, 2 * Math.PI);
        this.canvasCtx.stroke();
        
        // Calculate drag with smoothing (as percentage of canvas dimensions)
        let newFistDragX, newFistDragY;
        
        if (this.settings.moveMode === 'absolute') {
          // Absolute mode: current position as percentage of canvas
          newFistDragX = (wristX / this.canvas.width) * 100;
          newFistDragY = (wristY / this.canvas.height) * 100;
        } else {
          // Relative mode: movement from start position (inverted for intuitive direction)
          newFistDragX = -((wristX - this.fistStartX) / this.canvas.width) * 100;
          newFistDragY = -((wristY - this.fistStartY) / this.canvas.height) * 100;
        }
        
        this.fistDragX = sm * this.fistDragX + (1 - sm) * newFistDragX;
        this.fistDragY = sm * this.fistDragY + (1 - sm) * newFistDragY;
      }
      
      // Emit move event if there's significant movement
      if (this.isPinching || this.isFist) {
        this.events.emit('move', 
          this.isPinching ? this.pinchDragX : this.fistDragX,
          this.isPinching ? this.pinchDragY : this.fistDragY,
          { pinch: this.isPinching, fist: this.isFist }
        );
      }
    }
    
    this.canvasCtx.restore();
  }
  
  // Getter methods for current state
  getThumbIndexDistance() {
    return this.handDetected ? this.thumbIndexDistance : null;
  }
  
  getThumbIndexDistancePercent() {
    if (!this.handDetected) return null;
    
    // Calculate canvas diagonal as the maximum possible distance
    const canvasDiagonal = Math.sqrt(
      Math.pow(this.canvas.width, 2) + Math.pow(this.canvas.height, 2)
    );
    
    // Return thumb-index distance as percentage of canvas diagonal
    return (this.thumbIndexDistance / canvasDiagonal) * 100;
  }
  
  getPinchDrag() {
    return { 
      x: this.pinchDragX, // Now as percentage of canvas width
      y: this.pinchDragY, // Now as percentage of canvas height
      xPx: this.pinchDragX * this.canvas.width / 100, // Still available in pixels if needed
      yPx: this.pinchDragY * this.canvas.height / 100  // Still available in pixels if needed
    };
  }
  
  getFistDrag() {
    return { 
      x: this.fistDragX, // Now as percentage of canvas width
      y: this.fistDragY, // Now as percentage of canvas height
      xPx: this.fistDragX * this.canvas.width / 100, // Still available in pixels if needed
      yPx: this.fistDragY * this.canvas.height / 100  // Still available in pixels if needed
    };
  }
  
  isPinchActive() {
    return this.isPinching;
  }
  
  isFistActive() {
    return this.isFist;
  }
  
  // Utility methods for converting between percentage and pixels
  percentToPixels(percentX, percentY) {
    return {
      x: percentX * this.canvas.width / 100,
      y: percentY * this.canvas.height / 100
    };
  }
  
  pixelsToPercent(pixelX, pixelY) {
    return {
      x: (pixelX / this.canvas.width) * 100,
      y: (pixelY / this.canvas.height) * 100
    };
  }
  
  // Move mode control
  setMoveMode(mode) {
    if (mode === 'absolute' || mode === 'relative') {
      this.settings.moveMode = mode;
      // Reset drag values when switching modes to avoid jumps
      this.pinchDragX = 0;
      this.pinchDragY = 0;
      this.fistDragX = 0;
      this.fistDragY = 0;
      return true;
    }
    return false;
  }
  
  getMoveMode() {
    return this.settings.moveMode;
  }
}

// Export the class
export default HandGestures; 