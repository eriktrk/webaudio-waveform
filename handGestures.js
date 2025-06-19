class HandGestures {
  constructor(options = {}) {
    // Create internal elements
    this.video = document.createElement('video');
    this.video.setAttribute('playsinline', '');
    this.video.style.display = 'none'; // Hidden by default
    this.video.style.position = 'absolute';
    this.video.style.top = '50%';
    this.video.style.left = '50%';
    this.video.style.transform = 'translate(-50%, -50%)';
    this.video.style.objectFit = 'contain'; // Ensure video fits within container while maintaining aspect ratio

    this.canvas = document.createElement('canvas');
    this.canvas.width = options.width || 800;
    this.canvas.height = options.height || 600;
    this.canvas.style.display = 'none'; // Hidden by default
    this.canvas.style.position = 'absolute';
    this.canvas.style.top = '50%';
    this.canvas.style.left = '50%';
    this.canvas.style.transform = 'translate(-50%, -50%)';
    this.canvas.style.objectFit = 'contain';

    // Set initial responsive sizing after both elements are created
    this.updateVideoSizing();


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

    // Additional tracking for always-on move events
    this.indexX = 0;
    this.indexY = 0;
    this.thumbX = 0;
    this.thumbY = 0;

    // UI interaction tracking
    this.hoveredElement = null;
    this.clickableElements = [];
    this.pendingClickElement = null; // Track element clicked during pinch

    // Settings with defaults
    this.settings = {
      pinchEnabled: options.pinchEnabled || true,
      fistEnabled: options.fistEnabled || false,
      pinchThreshold: options.pinchThreshold || 35,
      fistThreshold: options.fistThreshold || 0.6,
      maxNumHands: options.maxNumHands || 1,
      modelComplexity: options.modelComplexity || 1,
      minDetectionConfidence: options.minDetectionConfidence || 0.8,
      minTrackingConfidence: options.minTrackingConfidence || 0.8,
      flipHorizontal: options.flipHorizontal !== undefined ? options.flipHorizontal : true,
      smoothingFactor: options.smoothingFactor || 0.3,
      moveMode: options.moveMode || 'relative', // 'absolute' | 'relative'
      width: options.width || 800,
      height: options.height || 600,
      alwaysEmitMove: options.alwaysEmitMove || false, // Emit move events even without gestures
      alwaysShowDots: options.alwaysShowDots || false  // Always show thumb/index dots
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

    // Set up automatic restart handling for critical errors
    this.events.on('restart-needed', async (error) => {
      console.warn('Critical error detected, attempting automatic restart:', error);
      const restartSuccess = await this.restart();
      if (!restartSuccess) {
        console.error('Automatic restart failed. Manual intervention may be required.');
        this.events.emit('error', new Error('Automatic restart failed after critical error'));
      }
    });
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

      // Initialize MediaPipe Hands with WebGL error handling
      this.hands = new Hands({
        locateFile: (file) => {
          return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
        }
      });

      // Use lower settings to reduce WebGL load
      this.hands.setOptions({
        maxNumHands: this.settings.maxNumHands,
        modelComplexity: this.settings.modelComplexity,
        minDetectionConfidence: this.settings.minDetectionConfidence,
        minTrackingConfidence: this.settings.minTrackingConfidence,
        flipHorizontal: this.settings.flipHorizontal,
        // Try to reduce GPU usage
        selfieMode: !this.settings.flipHorizontal
      });

      this.hands.onResults(this.onResults);

      // Add window resize listener for responsive video sizing
      this.resizeHandler = () => {
        this.updateVideoSizing();
      };
      window.addEventListener('resize', this.resizeHandler);

      return true;
    } catch (error) {
      console.error('Error initializing HandGestures:', error);
      if (error.message && error.message.includes('WebGL')) {
        console.warn('WebGL error detected. This may be due to hardware limitations or too many WebGL contexts.');
      }
      return false;
    }
  }

  async start() {
    try {
      // Ensure hands is initialized before starting camera
      if (!this.hands) {
        console.error('HandGestures not properly initialized. Call init() first.');
        this.events.emit('error', new Error('HandGestures not initialized'));
        return false;
      }

      // Let MediaPipe Camera class handle the camera setup entirely
      this.camera = new Camera(this.video, {
        onFrame: async () => {
          try {
            // Add null check to prevent the "Cannot read properties of null" error
            if (this.hands && this.video) {
              await this.hands.send({ image: this.video });
            }
          } catch (error) {
            console.warn('Error sending frame to MediaPipe:', error);
            // Attempt to restart if this is a critical error
            if (error.message && (error.message.includes('WebGL') || error.message.includes('context'))) {
              console.log('Attempting to restart hand gestures due to WebGL error...');
              this.events.emit('restart-needed', error);
            }
          }
        },
        width: this.canvas.width,
        height: this.canvas.height
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
    try {
      // Stop camera first to prevent onFrame callbacks during cleanup
      if (this.camera) {
        this.camera.stop();
        this.camera = null;
      }

      // MediaPipe Camera class handles stream cleanup internally
      // but we can also stop the video element's stream if it exists
      if (this.video.srcObject) {
        const stream = this.video.srcObject;
        stream.getTracks().forEach(track => track.stop());
        this.video.srcObject = null;
      }

      // Clear canvas and reset all state
      if (this.canvasCtx) {
        this.canvasCtx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      }

      // Clean up window resize listener
      if (this.resizeHandler) {
        window.removeEventListener('resize', this.resizeHandler);
        this.resizeHandler = null;
      }

      // Try to clean up MediaPipe resources to free WebGL contexts
      // Set to null first to prevent race conditions with onFrame callbacks
      const handsToClose = this.hands;
      this.hands = null;
      
      if (handsToClose) {
        try {
          // Additional cleanup attempt for WebAssembly module
          if (handsToClose.close) {
            handsToClose.close();
          }
          
          // Force garbage collection hint (not guaranteed but may help)
          if (window.gc) {
            window.gc();
          }
        } catch (e) {
          console.warn('Error closing MediaPipe hands:', e);
          // Continue cleanup even if close() fails
        }
      }

      this.resetGestureState();

      this.events.emit('stopped');
      return true;
    } catch (error) {
      console.error('Error during stop:', error);
      // Force reset even if cleanup failed
      this.hands = null;
      this.camera = null;
      this.resetGestureState();
      this.events.emit('stopped');
      return false;
    }
  }

  // Helper method to reset all gesture state
  resetGestureState() {
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
    this.handDetected = false;
    this.thumbIndexDistance = 0;

    // Clear UI interaction state
    if (this.hoveredElement) {
      this.hoveredElement.classList.remove('gesture-hover');
      this.hoveredElement = null;
    }
    this.pendingClickElement = null;

    // Reset finger positions
    this.indexX = 0;
    this.indexY = 0;
    this.thumbX = 0;
    this.thumbY = 0;
  }

  // Restart method for error recovery
  async restart() {
    console.log('Restarting HandGestures...');
    this.events.emit('restarting');
    
    try {
      // Stop everything first
      this.stop();
      
      // Small delay to ensure cleanup is complete
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Reinitialize and restart
      const initSuccess = await this.init();
      if (initSuccess) {
        const startSuccess = await this.start();
        if (startSuccess) {
          console.log('HandGestures restarted successfully');
          this.events.emit('restarted');
          return true;
        }
      }
      
      console.error('Failed to restart HandGestures');
      this.events.emit('restart-failed');
      return false;
    } catch (error) {
      console.error('Error during restart:', error);
      this.events.emit('restart-failed', error);
      return false;
    }
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

  updateVideoSizing() {
    // Responsive video sizing based on screen width
    // Use 768px as breakpoint (typical tablet/mobile breakpoint)
    const isWideScreen = window.innerWidth > 768;

    if (isWideScreen) {
      // Wide screens: height 100%, width auto
      this.video.style.height = '100%';
      this.video.style.width = 'auto';
    } else {
      // Narrow screens: width 100%, height auto
      this.video.style.width = '100%';
      this.video.style.height = 'auto';
    }

    // Update canvas sizing to match video
    this.updateCanvasSizing();
  }

  updateCanvasSizing() {
    // Safety check - only update if canvas exists
    if (!this.canvas) return;

    // Canvas should match video sizing to stay perfectly centered
    const isWideScreen = window.innerWidth > 768;

    if (isWideScreen) {
      // Wide screens: height 100%, width auto to match video
      this.canvas.style.height = '100%';
      this.canvas.style.width = 'auto';
    } else {
      // Narrow screens: width 100%, height auto to match video
      this.canvas.style.width = '100%';
      this.canvas.style.height = 'auto';
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

      // Store current positions for always-on tracking
      this.thumbX = thumbX;
      this.thumbY = thumbY;
      this.indexX = indexX;
      this.indexY = indexY;
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
      if (this.settings.pinchEnabled && this.thumbIndexDistance < this.settings.pinchThreshold && !this.isPinching) {
        this.isPinching = true;
        // Store start position - MediaPipe coordinates are already flip-adjusted
        this.pinchStartX = indexX;
        this.pinchStartY = indexY;

        // Reset smoothing buffer in absolute mode for immediate response
        if (this.settings.moveMode === 'absolute') {
          this.pinchDragX = (indexX / this.canvas.width) * 100;
          this.pinchDragY = (indexY / this.canvas.height) * 100;
        }

        this.events.emit('pinch', true);
      } else if (this.settings.pinchEnabled && this.thumbIndexDistance >= this.settings.pinchThreshold && this.isPinching) {
        this.isPinching = false;
        this.pinchStartX = 0;
        this.pinchStartY = 0;
        this.pinchDragX = 0;
        this.pinchDragY = 0;
        this.events.emit('pinch', false);
      }

      if (this.settings.fistEnabled) {
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
          // Store start position - MediaPipe coordinates are already flip-adjusted
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
      }
      // Show thumb and index finger dots
      if (this.settings.alwaysShowDots || this.isPinching) {
        // Set color based on pinching state
        this.canvasCtx.fillStyle = this.isPinching ? '#00FF00' : '#0009';

        // Calculate dot radius based on pinchThreshold (scale to reasonable size)
        const dotRadius = Math.max(4, Math.min(16, this.settings.pinchThreshold * 0.4));

        // Use raw MediaPipe coordinates - they're already adjusted for flip
        let displayThumbX = thumbX;
        let displayIndexX = indexX;

        // Draw thumb dot
        this.canvasCtx.beginPath();
        this.canvasCtx.arc(displayThumbX, thumbY, dotRadius, 0, 2 * Math.PI);
        this.canvasCtx.fill();

        // Draw index finger dot
        this.canvasCtx.beginPath();
        this.canvasCtx.arc(displayIndexX, indexY, dotRadius, 0, 2 * Math.PI);
        this.canvasCtx.fill();
      }

      // Calculate pinch drag when pinching
      if (this.isPinching) {
        // Calculate drag with smoothing (as percentage of canvas dimensions)
        // MediaPipe coordinates are already flip-adjusted
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
        // Draw a circle around the hand - MediaPipe coordinates are already flip-adjusted
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

      // Check for UI element interactions - MediaPipe coordinates are already flip-adjusted
      const elementInteraction = this.checkElementInteraction(indexX, indexY);

      if (elementInteraction) {
        const { element, callback } = elementInteraction;

        // Handle hover state
        if (this.hoveredElement !== element) {
          // Clear previous hover
          if (this.hoveredElement) {
            this.hoveredElement.classList.remove('gesture-hover');
          }

          // Set new hover
          this.hoveredElement = element;
          element.classList.add('gesture-hover');
          this.events.emit('elementHover', element);
        }

        // Handle pinch start (store element for click on release)
        if (this.isPinching && !wasPinching && callback) {
          this.pendingClickElement = { element, callback };
        }
      } else {
        // Clear hover if not over any element
        if (this.hoveredElement) {
          this.hoveredElement.classList.remove('gesture-hover');
          this.hoveredElement = null;
          this.events.emit('elementHover', null);
        }
      }

      // Handle pinch release (trigger click if we have a pending element)
      if (wasPinching && !this.isPinching && this.pendingClickElement) {
        const { element, callback } = this.pendingClickElement;
        // Only trigger if still over the same element
        if (elementInteraction && elementInteraction.element === element) {
          callback(element);
          this.events.emit('elementClick', element);
        }
        this.pendingClickElement = null;
      }

      // Clear pending click if pinch ends without proper release
      if (!this.isPinching && this.pendingClickElement) {
        this.pendingClickElement = null;
      }

      // Emit move event based on settings
      if (this.settings.alwaysEmitMove || this.isPinching || this.isFist) {
        let moveX, moveY;

        if (this.isPinching) {
          moveX = this.pinchDragX;
          moveY = this.pinchDragY;
        } else if (this.isFist) {
          moveX = this.fistDragX;
          moveY = this.fistDragY;
        } else if (this.settings.alwaysEmitMove) {
          // Use index finger position for general movement - MediaPipe coordinates are already flip-adjusted
          moveX = (indexX / this.canvas.width) * 100;
          moveY = (indexY / this.canvas.height) * 100;
        }

        this.events.emit('move',
          moveX,
          moveY,
          { pinch: this.isPinching, fist: this.isFist, hoveredElement: this.hoveredElement }
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

  // Register clickable elements within the video area
  registerClickableElement(element, callback) {
    this.clickableElements.push({ element, callback });
  }

  // Clear all registered clickable elements
  clearClickableElements() {
    this.clickableElements = [];
  }

  // Check if index finger is over any clickable element
  checkElementInteraction(canvasX, canvasY) {
    if (!this.clickableElements.length) return null;

    // Convert canvas coordinates to screen coordinates
    const container = this.canvas.parentElement;
    if (!container) return null;

    const canvasRect = this.canvas.getBoundingClientRect();

    // Convert canvas pixel coordinates to screen coordinates
    const screenX = (canvasX / this.canvas.width) * canvasRect.width + canvasRect.left;
    const screenY = (canvasY / this.canvas.height) * canvasRect.height + canvasRect.top;

    // Find overlapping elements
    for (const { element, callback } of this.clickableElements) {
      const elementRect = element.getBoundingClientRect();

      // Check if finger is over element (direct screen coordinate comparison)
      if (screenX >= elementRect.left &&
        screenX <= elementRect.right &&
        screenY >= elementRect.top &&
        screenY <= elementRect.bottom) {
        return { element, callback };
      }
    }

    return null;
  }
}

// Export the class
export default HandGestures; 