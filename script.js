/**
 * Web Audio Waveform Generator
 * Advanced waveform synthesis with harmonic generation and real-time visualization
 */

import HandGestures from "./handGestures.js";

class WaveformGenerator {
    constructor() {
        // Audio context and nodes
        this.audioContext = null;
        this.mainOscillator = null;
        this.harmonicOscillators = [];
        this.amOscillator = null;
        this.fmOscillator = null;
        this.gainNode = null;
        this.amGainNode = null;
        this.masterGainNode = null;
        this.analyser = null;
        this.isPlaying = false;
        
        // Waveform parameters
        this.frequency = 440;
        this.amplitude = 0.5;
        this.waveType = 'sine';
        this.phase = 0;
        this.volume = 0.5;
        this.smoothing = 0.1; // Square wave smoothing factor
        this.dutyCycle = 50; // Square wave duty cycle percentage
        
        // Harmonics array - each harmonic has frequency multiplier and amplitude
        this.harmonics = [];
        
        // Modulation parameters
        this.amEnabled = false;
        this.amFreq = 5;
        this.amDepth = 0.5;
        this.fmEnabled = false;
        this.fmFreq = 5;
        this.fmDepth = 50;
        
        // Display parameters - default to show 2 full cycles
        this.timeScale = this.calculateTimeScaleForCycles(2); // ms per division for 2 cycles
        this.ampScale = 1.0;  // volts per division
        
        // Canvas and visualization
        this.canvas = document.getElementById('waveformCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.animationId = null;
        
        // Sample rate and buffer for waveform calculation
        this.sampleRate = 44100;
        this.bufferSize = 2048;
        this.waveformData = new Float32Array(this.bufferSize);
        
        this.init();
        
        // Set initial time scale in UI after initialization
        setTimeout(() => {
            document.getElementById('timeScale').value = this.timeScale;
            document.getElementById('timeScaleValue').textContent = this.timeScale.toFixed(2);
        }, 0);

        // Initialize hand gestures system with video overlay control
        this.initializeVideoGestures();
        
        // Initialize melody controls with copy/paste functionality
        this.initializeMelodyInput();
        
        // Update melody name display after initialization
        setTimeout(() => {
            this.updateMelodyNameDisplay();
        }, 100);

    }
    
    /**
     * Calculate time scale to display specified number of cycles
     */
    calculateTimeScaleForCycles(cycles) {
        // Assuming canvas shows 10 divisions horizontally
        const divisions = 10;
        const period = 1000 / this.frequency; // period in ms
        return (cycles * period) / divisions;
    }

    /**
     * Initialize melody controls with copy/paste functionality
     */
    initializeMelodyInput() {
        const copyMelodyBtn = document.getElementById('copyMelody');
        const pasteMelodyBtn = document.getElementById('pasteMelody');
        
        if (!copyMelodyBtn || !pasteMelodyBtn) {
            console.warn('Melody control elements not found');
            return;
        }
        
        // Add event listeners
        copyMelodyBtn.addEventListener('click', () => {
            this.copyMelodyToClipboard();
        });
        
        pasteMelodyBtn.addEventListener('click', () => {
            this.pasteMelodyFromClipboard();
        });
    }
    
    /**
     * Copy current melody to clipboard as JSON
     */
    copyMelodyToClipboard() {
        try {
            const melodyJSON = JSON.stringify(this.melodyGuide, null, 2);
            navigator.clipboard.writeText(melodyJSON).then(() => {
                this.showToast('Melody copied to clipboard!', 'success');
            }).catch(() => {
                // Fallback for older browsers
                this.fallbackCopyToClipboard(melodyJSON);
            });
        } catch (error) {
            this.showToast('Error copying melody: ' + error.message, 'error');
            console.error('Melody copy error:', error);
        }
    }
    
    /**
     * Paste melody from clipboard and load it
     */
    async pasteMelodyFromClipboard() {
        try {
            const clipboardText = await navigator.clipboard.readText();
            this.loadMelodyFromJSON(clipboardText);
        } catch (error) {
            // If clipboard API fails, show a prompt for manual paste
            const pastedText = prompt('Paste melody JSON here:');
            if (pastedText) {
                this.loadMelodyFromJSON(pastedText);
            }
        }
    }
    
    /**
     * Load melody from JSON string
     */
    loadMelodyFromJSON(jsonString) {
        try {
            const melodyData = JSON.parse(jsonString);
            
            // Validate melody structure
            if (!melodyData.tempo || !Array.isArray(melodyData.notes)) {
                throw new Error('Invalid melody format. Must have "tempo" and "notes" array.');
            }
            
            // Extract unique note names from melody (excluding rests)
            const melodyNoteNames = new Set();
            for (let i = 0; i < melodyData.notes.length; i++) {
                const note = melodyData.notes[i];
                if (!Array.isArray(note) || note.length !== 2) {
                    throw new Error(`Invalid note at index ${i}. Each note must be [noteName, duration].`);
                }
                
                const [noteName, duration] = note;
                if (typeof noteName !== 'string' || typeof duration !== 'number') {
                    throw new Error(`Invalid note at index ${i}. Format: ["NoteName", durationNumber].`);
                }
                
                // Add non-rest notes to the set for frequency calculation
                if (noteName.trim() !== '' && noteName !== ' ') {
                    melodyNoteNames.add(noteName);
                }
            }
            
            // Calculate frequencies for all notes in the melody
            const calculatedNotes = this.calculateNotesAndFrequencies(Array.from(melodyNoteNames));
            
            // Validate that all notes could be calculated
            for (const noteName of melodyNoteNames) {
                if (!calculatedNotes.noteNames.includes(noteName)) {
                    throw new Error(`Unable to calculate frequency for note "${noteName}". Please use standard notation (e.g., C4, F#5, Bb3).`);
                }
            }
            
            // Update the notes and frequencies arrays
            this.notes = calculatedNotes.frequencies;
            this.noteNames = calculatedNotes.noteNames;
            
            // Apply the new melody
            this.melodyGuide = melodyData;
            
            // If the loaded melody doesn't have a name, provide a default
            if (!this.melodyGuide.name || this.melodyGuide.name.trim() === '') {
                this.melodyGuide.name = 'Custom Melody';
            }
            
            // Update melody name display
            this.updateMelodyNameDisplay();
            
            // Handle keyboard overlay updates (both oscilloscope and video modes)
            this.updateKeyboardAfterMelodyLoad();
            
            // Reset song guide if active
            if (this.songGuideActive) {
                this.currentSongNoteIndex = 0;
                this.clearNoteTimer();
                this.updateSongGuideDisplay();
            }
            
            // Calculate how many original notes vs padding notes
            const originalNotesCount = Array.from(melodyNoteNames).length;
            const paddingNotesCount = calculatedNotes.noteNames.length - originalNotesCount;
            
            this.showToast(`Melody loaded successfully! ${calculatedNotes.noteNames.length} notes available (${originalNotesCount} melody + ${paddingNotesCount} padding).`, 'success');
            
        } catch (error) {
            this.showToast('Error loading melody: ' + error.message, 'error');
            console.error('Melody load error:', error);
        }
    }
    
    /**
     * Fallback copy method for older browsers
     */
    fallbackCopyToClipboard(text) {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        textArea.select();
        try {
            document.execCommand('copy');
            this.showToast('Melody copied to clipboard!', 'success');
        } catch (err) {
            this.showToast('Failed to copy melody. Please copy manually.', 'error');
            console.error('Fallback copy failed:', err);
        }
        document.body.removeChild(textArea);
    }
    
    /**
     * Update the melody name display in the UI
     */
    updateMelodyNameDisplay() {
        const melodyNameElement = document.getElementById('currentMelodyName');
        if (!melodyNameElement) {
            console.warn('Melody name display element not found');
            return;
        }
        
        // Get melody name from current melody guide
        const melodyName = this.melodyGuide?.name || 'Untitled Melody';
        melodyNameElement.textContent = melodyName;
        
        console.log(`Updated melody name display: "${melodyName}"`);
    }
    
    /**
     * Setup hand gesture event handlers (extracted for reuse when recreating instances)
     */
    setupHandGestureEventHandlers() {
        if (!this.handGestures) {
            console.warn('Cannot setup event handlers: handGestures instance not available');
            return;
        }
        
        // Set up hand gesture event handlers
        this.handGestures.events.on('move', (x, y, data) => {
            // Don't process musical input if hovering over UI elements
            if (data && data.hoveredElement) {
                return;
            }
            
            // x coordinate is already properly adjusted by MediaPipe based on flip state
            // x is 0 to 100, map to frequency notes
            let frequency = 2000 - (x * 15);
            // Calculate note index based on hand position
            const noteIndex = Math.floor(x / (100 / this.notes.length));
            frequency = this.notes[noteIndex];

            if (!frequency) { return; }

            this.frequency = frequency;
            this.updateAudioFrequency();
            this.updateWaveform();
            
            // Update keyboard highlighting based on pinch state
            const isPinching = this.handGestures.isPinchActive();
            this.updateKeyboardHighlight(noteIndex, isPinching);
        });

        this.handGestures.events.on('pinch', (pinch) => {
            // Don't toggle playback if hovering over UI elements
            if (this.handGestures.hoveredElement) {
                return;
            }
            this.togglePlayback(pinch ? 'on' : 'off');
        });
    }
    
    /**
     * Calculate frequencies for notes and return sorted arrays with padding
     */
    calculateNotesAndFrequencies(noteNames) {
        const noteFrequencyPairs = [];
        const midiNumbers = [];
        
        // Calculate frequency and MIDI number for each valid note
        for (const noteName of noteNames) {
            const frequency = this.noteNameToFrequency(noteName);
            const midiNumber = this.noteNameToMIDI(noteName);
            if (frequency !== null && midiNumber !== null) {
                noteFrequencyPairs.push({ name: noteName, frequency: frequency, midi: midiNumber });
                midiNumbers.push(midiNumber);
            }
        }
        
        // Add padding notes (one semitone below lowest and one semitone above highest)
        if (midiNumbers.length > 0) {
            const lowestMidi = Math.min(...midiNumbers);
            const highestMidi = Math.max(...midiNumbers);
            
            // Add lower padding note (one semitone below)
            const lowerPaddingMidi = lowestMidi - 1;
            if (lowerPaddingMidi >= 0) {
                const lowerPaddingNote = this.midiToNoteName(lowerPaddingMidi);
                const lowerPaddingFreq = this.noteNameToFrequency(lowerPaddingNote);
                if (lowerPaddingNote && lowerPaddingFreq !== null) {
                    noteFrequencyPairs.push({ 
                        name: lowerPaddingNote, 
                        frequency: lowerPaddingFreq, 
                        midi: lowerPaddingMidi,
                        isPadding: true 
                    });
                }
            }
            
            // Add higher padding note (one semitone above)
            const higherPaddingMidi = highestMidi + 1;
            if (higherPaddingMidi <= 127) {
                const higherPaddingNote = this.midiToNoteName(higherPaddingMidi);
                const higherPaddingFreq = this.noteNameToFrequency(higherPaddingNote);
                if (higherPaddingNote && higherPaddingFreq !== null) {
                    noteFrequencyPairs.push({ 
                        name: higherPaddingNote, 
                        frequency: higherPaddingFreq, 
                        midi: higherPaddingMidi,
                        isPadding: true 
                    });
                }
            }
        }
        
        // Sort by frequency (ascending)
        noteFrequencyPairs.sort((a, b) => a.frequency - b.frequency);
        
        // Extract sorted arrays
        const sortedNoteNames = noteFrequencyPairs.map(pair => pair.name);
        const sortedFrequencies = noteFrequencyPairs.map(pair => pair.frequency);
        
        return {
            noteNames: sortedNoteNames,
            frequencies: sortedFrequencies
        };
    }
    
    /**
     * Convert note name to frequency using equal temperament tuning
     * @param {string} noteName - Note name in format like "A4", "C#5", "Bb3"
     * @returns {number|null} - Frequency in Hz, or null if invalid note name
     */
    noteNameToFrequency(noteName) {
        try {
            const midiNumber = this.noteNameToMIDI(noteName);
            if (midiNumber === null) return null;
            
            // Calculate frequency using equal temperament: f = 440 * 2^((n-69)/12)
            // Where 69 is the MIDI number for A4 (440 Hz)
            const frequency = 440 * Math.pow(2, (midiNumber - 69) / 12);
            return Math.round(frequency * 100) / 100; // Round to 2 decimal places
        } catch (error) {
            console.warn(`Invalid note name: ${noteName}`);
            return null;
        }
    }
    
    /**
     * Convert note name to MIDI number
     * @param {string} noteName - Note name in format like "A4", "C#5", "Bb3"
     * @returns {number|null} - MIDI number (0-127), or null if invalid
     */
    noteNameToMIDI(noteName) {
        const notePattern = /^([A-G])([#b]?)(\d+)$/;
        const match = noteName.match(notePattern);
        
        if (!match) return null;
        
        const [, noteLetter, accidental, octaveStr] = match;
        const octave = parseInt(octaveStr);
        
        // Validate octave range (MIDI supports 0-10, but we'll be more restrictive)
        if (octave < 0 || octave > 10) return null;
        
        // Base MIDI numbers for each note in octave 0
        const baseNotes = {
            'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11
        };
        
        let midiNumber = baseNotes[noteLetter] + (octave + 1) * 12;
        
        // Apply accidentals
        if (accidental === '#') {
            midiNumber += 1;
        } else if (accidental === 'b') {
            midiNumber -= 1;
        }
        
        // Validate MIDI range
        if (midiNumber < 0 || midiNumber > 127) return null;
        
        return midiNumber;
    }
    
    /**
     * Convert MIDI number to note name (using sharps for black keys)
     * @param {number} midiNumber - MIDI number (0-127)
     * @returns {string|null} - Note name in format like "A4", "C#5", or null if invalid
     */
    midiToNoteName(midiNumber) {
        if (midiNumber < 0 || midiNumber > 127) return null;
        
        const octave = Math.floor(midiNumber / 12) - 1;
        const noteInOctave = midiNumber % 12;
        
        // Note names using sharps for black keys
        const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
        
        return `${noteNames[noteInOctave]}${octave}`;
    }
    
    /**
     * Update keyboard overlay after melody load, handling both modes properly
     */
    updateKeyboardAfterMelodyLoad() {
        const wasVisible = this.keyboardOverlay && this.keyboardOverlay.classList.contains('visible');
        
        // Recreate keyboard overlay with new notes
        this.createKeyboardOverlay();
        
        // If we're in video mode (gestures running), handle special updates
        if (this.gesturesRunning) {
            // Show keyboard overlay if it was visible before
            if (wasVisible) {
                this.showKeyboardOverlay();
            }
            
            // Update overlay coverage to ensure proper positioning
            setTimeout(() => {
                this.updateOverlayCoverage();
            }, 50);
            
            // Re-register clickable elements with the hand gestures system
            // This ensures the gesture interaction system knows about the updated keyboard
            this.registerClickableElements();
            
            // Update hand gestures system with new note mapping
            // The move event handler will use the updated this.notes and this.noteNames arrays
            console.log(`Updated gesture keyboard: ${this.noteNames.length} notes ranging from ${this.noteNames[0]} to ${this.noteNames[this.noteNames.length - 1]}`);
        }
    }

    /**
     * Initialize video gestures system with overlay controls
     */
    initializeVideoGestures() {
        // Get video section and overlay elements (now in oscilloscope overlay)
        const videoSection = document.getElementById('video-section');
        const videoOverlay = document.getElementById('video-overlay');
        const gesturePlayBtn = document.getElementById('gesturePlayBtn');
        
        // Track gesture system state
        this.gesturesInitialized = false;
        this.gesturesRunning = false;
        this.hasEverUsedVideoMode = false; // Track if user has ever entered video mode
        this.handGestures = null; // Will be created when needed
        
        // Melody guide for GTA San Andreas theme
        // 1/4 = quarter note, 1/2 = half note, 1 = whole note
        // tempo 60 bpm means 1 second per quarter note
        // empty string or ' ' = rest
        this.melodyGuide = {
            name: 'GTA San Andreas Theme',
            tempo: 60,
            notes:  [
                ['D5', 1/8],
                ['D6', 1/8],
                ['Bb5', 1/8],
                ['A5', 1/16],
                ['Bb5', 1/16],
                ['A5', 1/16],
                ['G5', 1/16],
                ['A5', 1/16],
                ['G5', 1/16],
                ['A5', 1/8],
                [' ', 1/8],
                ['F5', 1/8],
                ['G5', 1/16],
                ['F5', 1/16],
                ['G5', 1/8],
                ['A5', 1/8],
                ['D5', 1/8],
                ['G5', 1/8],
                ['F5', 1/8],
                [' ', 1/8],
            ]
        };
        
        // Calculate frequencies for notes in default melody with padding
        const defaultMelodyNotes = new Set();
        this.melodyGuide.notes.forEach(([noteName]) => {
            if (noteName.trim() !== '' && noteName !== ' ') {
                defaultMelodyNotes.add(noteName);
            }
        });
        
        // Calculate and set notes/frequencies from default melody (includes padding)
        const calculatedNotes = this.calculateNotesAndFrequencies(Array.from(defaultMelodyNotes));
        this.notes = calculatedNotes.frequencies;
        this.noteNames = calculatedNotes.noteNames;
        
        console.log(`Default melody loaded: ${calculatedNotes.noteNames.length} total notes (${defaultMelodyNotes.size} melody + ${calculatedNotes.noteNames.length - defaultMelodyNotes.size} padding)`);

        // Current active note index for keyboard highlighting
        this.currentNoteIndex = -1;
        
        // Song guide state
        this.songGuideActive = false;
        this.currentSongNoteIndex = 0;
        this.noteHoldTimer = null;
        this.noteHoldDuration = 0;
        this.requiredHoldTime = 500; // ms to hold note (calculated per note)
        this.restTimer = null; // Timer for handling rest notes
        this.isMaximized = false;
        
        // Create keyboard overlay
        this.createKeyboardOverlay();
        
        // Flip button will be created as part of video controls when gestures start
        // Event handlers will be set up when HandGestures instance is created
        

        
        // Set up stop overlay functionality
        this.setupStopOverlay();
        
        // Set up gesture play button
        gesturePlayBtn.addEventListener('click', async () => {
            // Directly start gestures instead of just showing the overlay
            try {
                // Show video overlay
                this.showVideoOverlay();
                
                // Show loading state
                gesturePlayBtn.innerHTML = '<span style="opacity: 0.8;">📹 Starting...</span>';
                
                // Always create a new HandGestures instance to avoid MediaPipe WebAssembly corruption
                // This is necessary because MediaPipe cannot reliably be reinitialized after close()
                if (!this.gesturesInitialized || !this.handGestures) {
                    // Small delay to ensure complete cleanup of previous instance
                    await new Promise(resolve => setTimeout(resolve, 200));
                    
                    // Create fresh HandGestures instance
                    this.handGestures = new HandGestures({
                        width: 640,               // Reduced size to help with WebGL memory
                        height: 480,
                        moveMode: 'absolute',
                        pinchThreshold: 30,
                        alwaysEmitMove: true,     // Enable move events without gestures
                        alwaysShowDots: true,     // Always show thumb/index dots
                    });
                    
                    // Store flip state for keyboard overlay synchronization
                    this.isVideoFlipped = this.handGestures.settings.flipHorizontal;
                    
                    // Set up hand gesture event handlers for the new instance
                    this.setupHandGestureEventHandlers();
                    
                    // Initialize gestures system
                    const initSuccess = await this.handGestures.init();
                    if (!initSuccess) {
                        throw new Error('Failed to initialize hand gestures. This may be due to WebGL limitations or hardware compatibility issues. Try refreshing the page or using a different browser.');
                    }
                    this.gesturesInitialized = true;
                }
                
                // Attach to video section and start
                const videoSection = document.getElementById('video-section');
                this.handGestures.attachTo(videoSection);
                this.handGestures.showVisualization();
                
                const startSuccess = await this.handGestures.start();
                if (!startSuccess) {
                    throw new Error('Failed to start hand gestures');
                }
                
                this.gesturesRunning = true;
                
                // Mark that user has now used video mode (remove attention animation)
                if (!this.hasEverUsedVideoMode) {
                    this.hasEverUsedVideoMode = true;
                    this.removeAttentionAnimation();
                }
                
                // Show stop overlay
                this.showStopOverlay();
                
                // Show keyboard overlay
                this.showKeyboardOverlay();
                
                // Apply initial video transform for proper mirroring
                const video = this.handGestures.getVideoElement();
                if (video) {
                    if (this.isVideoFlipped) {
                        // Flipped mode: show actual camera view (with centering)
                        video.style.transform = 'translate(-50%, -50%) scaleX(1)';
                    } else {
                        // Normal mode: mirror the video for natural interaction (with centering)
                        video.style.transform = 'translate(-50%, -50%) scaleX(-1)';
                    }
                }
                
                // Register clickable elements for gesture interaction
                this.registerClickableElements();
                
                // Hide play corner button and video mode corner button
                this.hideCornerButtons();
                
                this.showToast('Hover and pinch to play notes.', 'success', 7000);
                
                // Reset button text
                gesturePlayBtn.innerHTML = '📹';
                
            } catch (error) {
                console.error('Error starting hand gestures:', error);
                this.showToast('Failed to start camera: ' + error.message, 'error');
                
                // Reset button
                gesturePlayBtn.innerHTML = '📹';
                
                // Hide video overlay on error
                this.hideVideoOverlay();
                
                // Ensure clean state after error
                this.gesturesInitialized = false;
                this.handGestures = null;
            }
        });
    }
    


    /**
     * Create keyboard overlay for visual note zones
     */
    createKeyboardOverlay() {
        const videoSection = document.getElementById('video-section');
        
        // Remove existing keyboard overlay if it exists
        const existingKeyboard = document.getElementById('keyboard-overlay');
        if (existingKeyboard) {
            existingKeyboard.remove();
        }
        
        // Create keyboard overlay container
        const keyboardOverlay = document.createElement('div');
        keyboardOverlay.id = 'keyboard-overlay';
        keyboardOverlay.className = 'keyboard-overlay';
        
        // Create keys for each note
        this.noteNames.forEach((noteName, index) => {
            const key = document.createElement('div');
            key.className = 'keyboard-key';
            key.dataset.noteIndex = index;
            key.textContent = noteName;
            key.title = `${noteName} (${this.notes[index].toFixed(1)} Hz)`;
            keyboardOverlay.appendChild(key);
        });
        
        videoSection.appendChild(keyboardOverlay);
        this.keyboardOverlay = keyboardOverlay;
        
        // Apply horizontal flip if video is flipped
        this.updateKeyboardOrientation();
    }
    
    /**
     * Update keyboard orientation to sync with video flip state
     */
    updateKeyboardOrientation() {
        if (!this.keyboardOverlay) {
            return;
        }
        
        // MediaPipe coordinates are consistent regardless of flip setting
        // Keep keyboard overlay orientation consistent with coordinate system
        this.keyboardOverlay.style.transform = 'scaleX(1)';
    }
    
    /**
     * Update keyboard highlighting based on current note and pinch state
     */
    updateKeyboardHighlight(noteIndex, isPinching = false) {
        if (!this.keyboardOverlay) {
            return;
        }
        
        // Remove previous highlighting from all keys
        if (this.currentNoteIndex >= 0) {
            const prevKey = this.keyboardOverlay.children[this.currentNoteIndex];
            if (prevKey) {
                prevKey.classList.remove('active', 'hover');
            }
        }
        
        // Add appropriate highlighting to current note
        if (noteIndex >= 0 && noteIndex < this.noteNames.length) {
            const currentKey = this.keyboardOverlay.children[noteIndex];
            if (currentKey) {
                if (isPinching) {
                    // Show active state when pinching
                    currentKey.classList.add('active');
                    currentKey.classList.remove('hover');
                    
                    // Handle song guide if active
                    this.handleSongGuideInput(noteIndex);
                } else {
                    // Show hover state when not pinching
                    currentKey.classList.add('hover');
                    currentKey.classList.remove('active');
                    
                    // Clear note timer if not pinching
                    this.clearNoteTimer();
                }
            }
        }
        
        this.currentNoteIndex = noteIndex;
    }
    
    /**
     * Handle song guide input and timing
     */
    handleSongGuideInput(noteIndex) {
        if (!this.songGuideActive || this.currentSongNoteIndex >= this.melodyGuide.notes.length) {
            return;
        }
        
        const currentSongNote = this.melodyGuide.notes[this.currentSongNoteIndex];
        const targetNoteName = currentSongNote[0];
        const currentNoteName = this.noteNames[noteIndex];
        
        // Check if correct note is being pinched
        if (currentNoteName === targetNoteName) {
            // Start timer if not already running
            if (!this.noteHoldTimer) {
                this.startNoteTimer(noteIndex);
            }
        } else {
            // Wrong note, clear timer
            this.clearNoteTimer();
        }
    }
    
    /**
     * Start note hold timer with visual fill effect
     */
    startNoteTimer(noteIndex) {
        const startTime = Date.now();
        this.noteHoldDuration = 0;
        
        const updateTimer = () => {
            this.noteHoldDuration = Date.now() - startTime;
            const fillPercent = Math.min(100, (this.noteHoldDuration / this.requiredHoldTime) * 100);
            
            // Update visual fill
            const currentKey = this.keyboardOverlay.children[noteIndex];
            if (currentKey) {
                currentKey.style.setProperty('--fill-percent', `${fillPercent}%`);
                currentKey.classList.add('timer-fill');
            }
            
            if (this.noteHoldDuration >= this.requiredHoldTime) {
                // Note held long enough, advance to next
                this.advanceToNextNote();
                this.clearNoteTimer();
            } else if (this.noteHoldTimer) {
                // Continue timer
                this.noteHoldTimer = requestAnimationFrame(updateTimer);
            }
        };
        
        this.noteHoldTimer = requestAnimationFrame(updateTimer);
    }
    
    /**
     * Clear note hold timer and visual effects
     */
    clearNoteTimer() {
        if (this.noteHoldTimer) {
            cancelAnimationFrame(this.noteHoldTimer);
            this.noteHoldTimer = null;
        }
        
        // Clear visual fill from all keys
        Array.from(this.keyboardOverlay.children).forEach(key => {
            key.classList.remove('timer-fill');
            key.style.removeProperty('--fill-percent');
        });
        
        this.noteHoldDuration = 0;
    }
    
    /**
     * Handle rest notes by waiting for the specified duration
     */
    handleRestNote() {
        // Clear any existing rest timer
        if (this.restTimer) {
            clearTimeout(this.restTimer);
            this.restTimer = null;
        }
        
        // Wait for the required rest duration then advance
        this.restTimer = setTimeout(() => {
            this.restTimer = null;
            this.advanceToNextNote();
        }, this.requiredHoldTime);
    }
    
    /**
     * Advance to next note in song guide
     */
    advanceToNextNote() {
        this.currentSongNoteIndex++;
        
        if (this.currentSongNoteIndex >= this.melodyGuide.notes.length) {
            // Song completed - restart from beginning
            this.showToast('Song completed! Restarting... 🎉', 'success', 2000);
            this.currentSongNoteIndex = 0;
            this.updateSongGuideDisplay();
        } else {
            this.updateSongGuideDisplay();
        }
    }
    
    /**
     * Update song guide visual display
     */
    updateSongGuideDisplay() {
        if (!this.songGuideActive || !this.keyboardOverlay) {
            return;
        }
        
        // Clear previous target highlighting
        Array.from(this.keyboardOverlay.children).forEach(key => {
            key.classList.remove('target');
        });
        
        // Highlight current target note
        if (this.currentSongNoteIndex < this.melodyGuide.notes.length) {
            const currentSongNote = this.melodyGuide.notes[this.currentSongNoteIndex];
            const targetNoteName = currentSongNote[0];
            const noteDuration = currentSongNote[1];
            
            // Calculate required hold time based on note duration and tempo
            // 60 bpm = 1000ms per quarter note
            const quarterNoteTime = (60 / this.melodyGuide.tempo) * 1000;
            this.requiredHoldTime = quarterNoteTime * (noteDuration / 0.25); // 0.25 = 1/4 note
            
            // Handle rests
            if (targetNoteName.trim() === '' || targetNoteName === ' ') {
                this.handleRestNote();
                return;
            }
            
            const targetNoteIndex = this.noteNames.indexOf(targetNoteName);
            if (targetNoteIndex >= 0) {
                const targetKey = this.keyboardOverlay.children[targetNoteIndex];
                if (targetKey) {
                    targetKey.classList.add('target');
                }
            }
        }
    }
    
    /**
     * Clear song guide visual display
     */
    clearSongGuideDisplay() {
        if (!this.keyboardOverlay) {
            return;
        }
        
        Array.from(this.keyboardOverlay.children).forEach(key => {
            key.classList.remove('target', 'timer-fill');
            key.style.removeProperty('--fill-percent');
        });
        
        // Clear rest timer if active
        if (this.restTimer) {
            clearTimeout(this.restTimer);
            this.restTimer = null;
        }
    }
    
    /**
     * Register clickable elements for gesture interaction
     */
    registerClickableElements() {
        if (!this.handGestures) return;
        
        // Clear previous registrations
        this.handGestures.clearClickableElements();
        
        // Register stop button
        const stopButton = document.getElementById('stop-btn');
        if (stopButton) {
            this.handGestures.registerClickableElement(stopButton, () => {
                this.stopVideoGestures();
            });
        }
        
        // Register flip button (top left corner)
        const flipBtn = document.getElementById('flip-btn');
        if (flipBtn) {
            this.handGestures.registerClickableElement(flipBtn, () => {
                this.toggleCameraFlip();
            });
        }
        
        // Maximize functionality removed
        
        const songGuideBtn = document.getElementById('song-guide-btn');
        if (songGuideBtn) {
            this.handGestures.registerClickableElement(songGuideBtn, () => {
                this.toggleSongGuide();
            });
        }
    }
    
    /**
     * Show keyboard overlay
     */
    showKeyboardOverlay() {
        if (this.keyboardOverlay) {
            this.keyboardOverlay.classList.add('visible');
            // Ensure perfect coverage after showing
            setTimeout(() => this.updateOverlayCoverage(), 50);
        }
    }
    
    /**
     * Hide keyboard overlay
     */
    hideKeyboardOverlay() {
        if (this.keyboardOverlay) {
            this.keyboardOverlay.classList.remove('visible');
            // Clear any active highlighting
            this.updateKeyboardHighlight(-1, false);
            
            // Also clear all highlighting from all keys
            Array.from(this.keyboardOverlay.children).forEach(key => {
                key.classList.remove('active', 'hover');
            });
        }
    }

    /**
     * Show video controls when gestures are running
     */
    showStopOverlay() {
        const videoSection = document.getElementById('video-section');
        
        // Create video controls if they don't exist
        let videoControls = document.getElementById('video-controls');
        if (!videoControls) {
            videoControls = document.createElement('div');
            videoControls.id = 'video-controls';
            videoControls.className = 'video-controls';
            
            // Left side controls
            const leftControls = document.createElement('div');
            leftControls.className = 'video-controls-left';
            
            // Flip button
            const flipBtn = document.createElement('button');
            flipBtn.id = 'flip-btn';
            flipBtn.className = 'video-control-btn';
            flipBtn.textContent = '↔';
            flipBtn.title = 'Flip Camera';
            
            leftControls.appendChild(flipBtn);
            
            // Center controls
            const centerControls = document.createElement('div');
            centerControls.className = 'video-controls-center';
            centerControls.style.cssText = 'position: absolute; left: 50%; transform: translateX(-50%); display: flex; gap: 0.25rem;';
            
            // Song guide button (moved to center)
            const songGuideBtn = document.createElement('button');
            songGuideBtn.id = 'song-guide-btn';
            songGuideBtn.className = 'video-control-btn';
            songGuideBtn.textContent = '🎵';
            songGuideBtn.title = 'Start/Stop Song Guide';
            
            centerControls.appendChild(songGuideBtn);
            
            // Right side controls
            const rightControls = document.createElement('div');
            rightControls.className = 'video-controls-right';
            
            // Stop button (moved to right with X icon)
            const stopBtn = document.createElement('button');
            stopBtn.id = 'stop-btn';
            stopBtn.className = 'video-control-btn';
            stopBtn.textContent = '✕';
            stopBtn.title = 'Stop Gestures';
            
            rightControls.appendChild(stopBtn);
            
            // Assemble video controls
            videoControls.appendChild(leftControls);
            videoControls.appendChild(centerControls);
            videoControls.appendChild(rightControls);
            videoSection.appendChild(videoControls);
            
            // Add event listeners
            flipBtn.addEventListener('click', () => this.toggleCameraFlip());
            stopBtn.addEventListener('click', () => this.stopVideoGestures());
            songGuideBtn.addEventListener('click', () => this.toggleSongGuide());
            
            // Ensure perfect coverage after creating controls
            setTimeout(() => this.updateOverlayCoverage(), 50);
        }
    }
    
    /**
     * Setup video interaction handlers
     */
    setupStopOverlay() {
        // Handle clicks on the video itself when gestures are running to stop them
        document.addEventListener('click', (e) => {
            const videoSection = document.getElementById('video-section');
            const clickedVideo = e.target.closest('video');
            
            if (clickedVideo && videoSection.contains(clickedVideo) && this.gesturesRunning) {
                this.stopVideoGestures();
            }
        });
    }
    
    // Maximize functionality removed - video overlay mode now serves this purpose
    
    /**
     * Toggle camera flip
     */
    toggleCameraFlip() {
        if (!this.handGestures) {
            this.showToast('Camera not available', 'warning');
            return;
        }
        
        // Toggle flip setting
        this.handGestures.settings.flipHorizontal = !this.handGestures.settings.flipHorizontal;
        this.isVideoFlipped = this.handGestures.settings.flipHorizontal;
        
        // Apply CSS transform to video element for visual mirroring in normal mode
        const video = this.handGestures.getVideoElement();
        if (video) {
            if (this.isVideoFlipped) {
                // Flipped mode: show actual camera view (with centering)
                video.style.transform = 'translate(-50%, -50%) scaleX(1)';
            } else {
                // Normal mode: mirror the video for natural interaction (with centering)
                video.style.transform = 'translate(-50%, -50%) scaleX(-1)';
            }
        }
        
        // Update keyboard overlay orientation
        this.updateKeyboardOrientation();
        
        // If gestures are running, update MediaPipe settings
        if (this.gesturesRunning && this.handGestures.hands) {
            this.handGestures.hands.setOptions({
                flipHorizontal: this.handGestures.settings.flipHorizontal,
                selfieMode: !this.handGestures.settings.flipHorizontal
            });
        }
        
        this.showToast(`Camera ${this.isVideoFlipped ? 'flipped' : 'normal'}`, 'info');
    }
    
    /**
     * Toggle song guide on/off
     */
    toggleSongGuide() {
        const songGuideBtn = document.getElementById('song-guide-btn');
        
        if (!this.songGuideActive) {
            this.songGuideActive = true;
            this.currentSongNoteIndex = 0;
            songGuideBtn.classList.add('active');
            songGuideBtn.title = 'Stop Song Guide';
            this.updateSongGuideDisplay();
            this.showToast('Song guide started! Follow the highlighted notes.', 'info', 3000);
        } else {
            this.songGuideActive = false;
            songGuideBtn.classList.remove('active');
            songGuideBtn.title = 'Start Song Guide';
            this.clearSongGuideDisplay();
            this.clearNoteTimer();
            this.showToast('Song guide stopped.', 'info');
        }
    }
    
    /**
     * Stop video gestures and show play overlay
     */
    stopVideoGestures() {
        if (this.handGestures && this.gesturesRunning) {
            try {
                this.handGestures.stop();
                this.gesturesRunning = false;
                
                // Stop song guide
                if (this.songGuideActive) {
                    this.toggleSongGuide();
                }
                
                // Clear any pending rest timer
                if (this.restTimer) {
                    clearTimeout(this.restTimer);
                    this.restTimer = null;
                }
                
                // Hide video controls
                const videoControls = document.getElementById('video-controls');
                if (videoControls) {
                    videoControls.remove();
                }
                
                // Clear clickable element registrations
                if (this.handGestures) {
                    this.handGestures.clearClickableElements();
                }
                
                // Hide keyboard overlay
                this.hideKeyboardOverlay();
                
                // Hide video overlay and return to oscilloscope
                this.hideVideoOverlay();
                
                // Force complete cleanup and recreation due to MediaPipe WebAssembly module corruption
                // MediaPipe has issues with reinitialization after calling close()
                this.gesturesInitialized = false;
                this.handGestures = null;
                
                this.showToast('Hand gestures stopped.', 'info');
                
            } catch (error) {
                console.error('Error stopping hand gestures:', error);
                
                // Force complete cleanup
                this.gesturesInitialized = false;
                this.handGestures = null;
                
                this.showToast('Hand gestures stopped with errors. Next start will reinitialize.', 'warning');
            }
        }
    }

    /**
     * Show video overlay on top of oscilloscope
     */
    showVideoOverlay() {
        const videoOverlay = document.getElementById('video-overlay');
        const videoSection = document.getElementById('video-section');
        const waveformCanvas = document.getElementById('waveformCanvas');
        const displayControls = document.querySelector('.display-controls');
        
        // Show video overlay
        videoOverlay.classList.remove('hidden');
        
        // Hide oscilloscope elements
        if (waveformCanvas) {
            waveformCanvas.style.display = 'none';
        }
        if (displayControls) {
            displayControls.style.display = 'none';
        }
        
        // Set video elements to relative positioning for proper sizing
        videoOverlay.style.position = 'relative';
        if (videoSection) {
            videoSection.style.position = 'relative';
        }
        
        // Hide corner buttons
        this.hideCornerButtons();
        
        // Update video sizing for responsive behavior
        if (this.handGestures) {
            this.handGestures.updateVideoSizing();
        }
        
        // Ensure perfect coverage after showing
        setTimeout(() => this.updateOverlayCoverage(), 50);
    }
    
    /**
     * Hide video overlay and return to oscilloscope
     */
    hideVideoOverlay() {
        const videoOverlay = document.getElementById('video-overlay');
        const videoSection = document.getElementById('video-section');
        const waveformCanvas = document.getElementById('waveformCanvas');
        const displayControls = document.querySelector('.display-controls');
        
        // Hide video overlay
        videoOverlay.classList.add('hidden');
        
        // Show oscilloscope elements
        if (waveformCanvas) {
            waveformCanvas.style.display = '';
        }
        if (displayControls) {
            displayControls.style.display = '';
        }
        
        // Reset video elements to original positioning
        videoOverlay.style.position = '';
        if (videoSection) {
            videoSection.style.position = '';
        }
        
        // Show corner buttons
        this.showCornerButtons();
    }

    /**
     * Show toaster notification
     */
    showToast(message, type = 'info', duration = 3000) {
        const toaster = document.getElementById('toaster');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        
        toaster.appendChild(toast);
        
        // Auto remove after duration
        setTimeout(() => {
            toast.style.animation = 'slideOut 0.3s ease forwards';
            setTimeout(() => {
                if (toast.parentNode) {
                    toast.parentNode.removeChild(toast);
                }
            }, 300);
        }, duration);
    }

    /**
     * Initialize the application - setup event listeners and draw initial waveform
     */
    init() {
        this.setupEventListeners();
        this.loadPresetsFromStorage();
        this.initializeDefaultPresets();
        this.loadFromURL();
        this.updateWaveform();
        this.drawWaveform();
        this.startVisualization();
        this.setupCanvasResize();
        
        // Update square wave controls after DOM is fully ready
        setTimeout(() => {
            this.updateSquareWaveControls();
            // Start attention animation for first-time users
            this.addAttentionAnimation();
        }, 100);
    }
    
    /**
     * Setup all event listeners for UI controls
     */
    setupEventListeners() {
        // Fundamental wave controls
        this.addSliderListener('frequency', (value) => {
            this.frequency = parseFloat(value);
            // Update time scale to maintain 2 cycles display
            this.timeScale = this.calculateTimeScaleForCycles(2);
            document.getElementById('timeScale').value = this.timeScale;
            document.getElementById('timeScaleValue').textContent = this.timeScale.toFixed(2);
            this.updateWaveform();
            this.updateAudioFrequency();
        });
        
        this.addSliderListener('amplitude', (value) => {
            this.amplitude = parseFloat(value);
            this.updateWaveform();
            this.updateAudioAmplitude();
        });
        
        this.addSliderListener('phase', (value) => {
            this.phase = parseFloat(value) * Math.PI / 180; // Convert to radians
            this.updateWaveform();
            this.updateAudioWaveType();
        });
        
        this.addSliderListener('smoothing', (value) => {
            this.smoothing = parseFloat(value);
            this.updateWaveform();
            // Force recreation of audio waveform when smoothing changes
            if (this.waveType === 'square') {
                this.updateAudioWaveType();
            }
        });
        
        this.addSliderListener('dutyCycle', (value) => {
            this.dutyCycle = parseFloat(value);
            this.updateWaveform();
            // Force recreation of audio waveform when duty cycle changes
            if (this.waveType === 'square') {
                this.updateAudioWaveType();
            }
        });
        
        document.getElementById('waveType').addEventListener('change', (e) => {
            this.waveType = e.target.value;
            this.updateSquareWaveControls();
            this.updateWaveform();
            this.updateAudioWaveType();
        });
        
        // Display controls
        this.addSliderListener('timeScale', (value) => {
            this.timeScale = parseFloat(value);
        });
        
        this.addSliderListener('ampScale', (value) => {
            this.ampScale = parseFloat(value);
        });
        
        // Modulation controls
        document.getElementById('enableAM').addEventListener('change', (e) => {
            this.amEnabled = e.target.checked;
            this.updateWaveform();
            this.updateAudioModulation();
        });
        
        this.addSliderListener('amFreq', (value) => {
            this.amFreq = parseFloat(value);
            this.updateWaveform();
            this.updateAudioModulation();
        });
        
        this.addSliderListener('amDepth', (value) => {
            this.amDepth = parseFloat(value);
            this.updateWaveform();
            this.updateAudioModulation();
        });
        
        document.getElementById('enableFM').addEventListener('change', (e) => {
            this.fmEnabled = e.target.checked;
            this.updateWaveform();
            this.updateAudioModulation();
        });
        
        this.addSliderListener('fmFreq', (value) => {
            this.fmFreq = parseFloat(value);
            this.updateWaveform();
            this.updateAudioModulation();
        });
        
        this.addSliderListener('fmDepth', (value) => {
            this.fmDepth = parseFloat(value);
            this.updateWaveform();
            this.updateAudioModulation();
        });
        
        // Playback controls
        this.addSliderListener('volume', (value) => {
            this.volume = parseFloat(value) / 100;
            this.updateAudioVolume();
        });
        
        document.getElementById('playStopBtn').addEventListener('click', () => {
            this.togglePlayback();
        });
        
        // Harmonics
        document.getElementById('addHarmonic').addEventListener('click', () => {
            this.addHarmonic();
        });
        
        // Presets
        document.getElementById('savePreset').addEventListener('click', () => {
            this.savePreset();
        });
        
        document.getElementById('loadPreset').addEventListener('click', () => {
            this.loadPreset();
        });
        
        document.getElementById('deletePreset').addEventListener('click', () => {
            this.deletePreset();
        });
        
        document.getElementById('sharePreset').addEventListener('click', () => {
            this.sharePreset();
        });
        
        // Collapsible sections
        this.setupCollapsibleSections();
    }
    
    /**
     * Setup collapsible sections with toggle functionality
     */
    setupCollapsibleSections() {
        // Header toggle
        const headerToggle = document.getElementById('headerToggle');
        const topBar = document.getElementById('topBar');
        if (headerToggle && topBar) {
            headerToggle.addEventListener('click', () => {
                topBar.classList.toggle('collapsed');
                headerToggle.classList.toggle('collapsed');
            });
        }
        
        // Fundamental Wave section
        const fundamentalToggle = document.getElementById('fundamentalToggle');
        const fundamentalSection = document.getElementById('fundamentalSection');
        if (fundamentalToggle && fundamentalSection) {
            fundamentalToggle.addEventListener('click', () => {
                fundamentalSection.classList.toggle('collapsed');
                fundamentalToggle.classList.toggle('collapsed');
            });
        }
        
        // Modulation section
        const modulationToggle = document.getElementById('modulationToggle');
        const modulationSection = document.getElementById('modulationSection');
        if (modulationToggle && modulationSection) {
            modulationToggle.addEventListener('click', () => {
                modulationSection.classList.toggle('collapsed');
                modulationToggle.classList.toggle('collapsed');
            });
        }
        
        // Harmonics section
        const harmonicsToggle = document.getElementById('harmonicsToggle');
        const harmonicsSection = document.getElementById('harmonicsSection');
        if (harmonicsToggle && harmonicsSection) {
            harmonicsToggle.addEventListener('click', () => {
                harmonicsSection.classList.toggle('collapsed');
                harmonicsToggle.classList.toggle('collapsed');
            });
        }
    }
    
    /**
     * Helper method to add slider event listeners with value display updates
     */
    addSliderListener(id, callback) {
        const slider = document.getElementById(id);
        // Map to correct value display IDs
        const valueDisplayMap = {
            'frequency': 'freqValue',
            'amplitude': 'ampValue',
            'phase': 'phaseValue',
            'smoothing': 'smoothingValue',
            'dutyCycle': 'dutyCycleValue',
            'timeScale': 'timeScaleValue',
            'ampScale': 'ampScaleValue',
            'volume': 'volumeValue',
            'amFreq': 'amFreqValue',
            'amDepth': 'amDepthValue',
            'fmFreq': 'fmFreqValue',
            'fmDepth': 'fmDepthValue'
        };
        const valueDisplay = document.getElementById(valueDisplayMap[id] || id + 'Value');
        
        if (!slider) {
            console.warn(`Slider with id '${id}' not found`);
            return;
        }
        
        slider.addEventListener('input', (e) => {
            const value = e.target.value;
            if (valueDisplay) {
                // Format different types of values appropriately
                if (id === 'frequency') {
                    valueDisplay.textContent = parseFloat(value).toFixed(0);
                } else if (id === 'phase' || id === 'dutyCycle') {
                    valueDisplay.textContent = parseFloat(value).toFixed(0);
                } else {
                    valueDisplay.textContent = parseFloat(value).toFixed(2);
                }
            }
            callback(value);
        });
    }
    
    /**
     * Show/hide square wave specific controls based on selected wave type
     */
    updateSquareWaveControls() {
        const smoothingControl = document.getElementById('smoothingControl');
        const dutyCycleControl = document.getElementById('dutyCycleControl');
        
        if (!smoothingControl || !dutyCycleControl) {
            console.warn('Square wave control elements not found');
            return;
        }
        
        console.log(`Updating square wave controls for wave type: ${this.waveType}`);
        
        if (this.waveType === 'square') {
            smoothingControl.classList.add('visible');
            dutyCycleControl.classList.add('visible');
            smoothingControl.style.display = 'flex';
            dutyCycleControl.style.display = 'flex';
        } else {
            smoothingControl.classList.remove('visible');
            dutyCycleControl.classList.remove('visible');
            smoothingControl.style.display = 'none';
            dutyCycleControl.style.display = 'none';
        }
    }

    /**
     * Helper method for harmonic slider listeners with custom value display ID
     */
    addHarmonicSliderListener(sliderId, valueDisplayId, callback) {
        const slider = document.getElementById(sliderId);
        const valueDisplay = document.getElementById(valueDisplayId);
        
        if (!slider) {
            console.warn(`Harmonic slider with id '${sliderId}' not found`);
            return;
        }
        
        slider.addEventListener('input', (e) => {
            const value = e.target.value;
            if (valueDisplay) {
                // Format phase values as integers, others as 2 decimal places
                if (sliderId.includes('-phase')) {
                    valueDisplay.textContent = parseInt(value);
                } else {
                    valueDisplay.textContent = parseFloat(value).toFixed(2);
                }
            }
            callback(value);
        });
    }
    
    /**
     * Add a new harmonic control to the UI
     */
    addHarmonic() {
        // Add to harmonics array
        this.harmonics.push({
            multiplier: 2,
            amplitude: 0.3,
            phase: 0 // Phase in degrees
        });
        
        // Recalculate and rebuild all harmonics
        this.rebuildAllHarmonics();
        
        this.updateWaveform();
        this.updateAudioHarmonics();
    }
    
    /**
     * Remove a harmonic from the system
     */
    removeHarmonic(index) {
        // Remove from array (index is 0-based)
        this.harmonics.splice(index, 1);
        
        // Recalculate and rebuild all harmonics
        this.rebuildAllHarmonics();
        
        this.updateWaveform();
        this.updateAudioHarmonics();
    }
    
    /**
     * Rebuild all harmonic UI elements with sequential numbering
     */
    rebuildAllHarmonics() {
        const container = document.getElementById('harmonicsContainer');
        
        // Clear all existing harmonic controls
        container.innerHTML = '';
        
        // Rebuild each harmonic with sequential ID (1-based display)
        this.harmonics.forEach((harmonic, index) => {
            const harmonicId = index + 1; // Display as 1, 2, 3, etc.
            
            // Create UI element
            const harmonicDiv = document.createElement('div');
            harmonicDiv.className = 'harmonic-control';
            harmonicDiv.id = `harmonic-${harmonicId}`;
            
            harmonicDiv.innerHTML = `
                <span>${harmonicId}</span>
                <button class="delete-btn" data-harmonic-index="${index}" title="Delete harmonic">🗑️</button>
                <div>
                    <label>
                        <div class="label-row">
                            <span class="label-text">Multiplier:</span>
                            <span class="label-value" id="harmonic-${harmonicId}-mult-value">${harmonic.multiplier.toFixed(2)}</span>
                        </div>
                        <input type="range" id="harmonic-${harmonicId}-mult" min="0.1" max="10" step="0.1" value="${harmonic.multiplier}">
                    </label>
                    <label>
                        <div class="label-row">
                            <span class="label-text">Amplitude:</span>
                            <span class="label-value" id="harmonic-${harmonicId}-amp-value">${harmonic.amplitude.toFixed(2)}</span>
                        </div>
                        <input type="range" id="harmonic-${harmonicId}-amp" min="0" max="1" step="0.01" value="${harmonic.amplitude}">
                    </label>
                    <label>
                        <div class="label-row">
                            <span class="label-text">Phase:</span>
                            <span class="label-value"><span id="harmonic-${harmonicId}-phase-value">${harmonic.phase}</span>°</span>
                        </div>
                        <input type="range" id="harmonic-${harmonicId}-phase" min="0" max="360" step="1" value="${harmonic.phase}">
                    </label>
                </div>
            `;
            
            // Add event listener for delete button
            const deleteBtn = harmonicDiv.querySelector('.delete-btn');
            deleteBtn.addEventListener('click', () => {
                this.removeHarmonic(index);
            });
            
            container.appendChild(harmonicDiv);
            
            // Add event listeners for the harmonic controls
            this.addHarmonicSliderListener(`harmonic-${harmonicId}-mult`, `harmonic-${harmonicId}-mult-value`, (value) => {
                this.harmonics[index].multiplier = parseFloat(value);
                this.updateWaveform();
                this.updateAudioHarmonics();
            });
            
            this.addHarmonicSliderListener(`harmonic-${harmonicId}-amp`, `harmonic-${harmonicId}-amp-value`, (value) => {
                this.harmonics[index].amplitude = parseFloat(value);
                this.updateWaveform();
                this.updateAudioHarmonics();
            });
            
            this.addHarmonicSliderListener(`harmonic-${harmonicId}-phase`, `harmonic-${harmonicId}-phase-value`, (value) => {
                this.harmonics[index].phase = parseFloat(value);
                this.updateWaveform();
                this.updateAudioHarmonics();
            });
        });
    }
    
    /**
     * Generate base waveform based on selected type
     */
    generateBaseWaveform(t) {
        switch (this.waveType) {
            case 'sine':
                return Math.sin(2 * Math.PI * this.frequency * t + this.phase);
            case 'square':
                const squarePhase = (2 * Math.PI * this.frequency * t + this.phase) % (2 * Math.PI);
                const normalizedPhase = squarePhase / (2 * Math.PI); // 0 to 1
                
                // Create square wave with duty cycle and smoothed rising edge
                const dutyCycleRatio = this.dutyCycle / 100; // Convert percentage to ratio
                const maxRiseTime = dutyCycleRatio * 0.5; // Max rise time is 50% of duty cycle width
                const riseTime = Math.min(this.smoothing * 0.5, maxRiseTime); // Limit rise time
                
                if (normalizedPhase < riseTime) {
                    // Smooth rising edge using exponential curve for natural sound
                    const riseProgress = normalizedPhase / riseTime;
                    // Use exponential curve for more natural rising edge
                    const smoothedRise = 1 - Math.exp(-5 * riseProgress);
                    return -1 + 2 * smoothedRise;
                } else if (normalizedPhase < dutyCycleRatio) {
                    // High plateau - duration controlled by duty cycle
                    return 1;
                } else {
                    // Instant falling edge and low plateau
                    return -1;
                }
            case 'sawtooth':
                return 2 * ((this.frequency * t + this.phase / (2 * Math.PI)) % 1) - 1;
            case 'triangle':
                const sawValue = 2 * ((this.frequency * t + this.phase / (2 * Math.PI)) % 1) - 1;
                return 2 * Math.abs(sawValue) - 1;
            default:
                return Math.sin(2 * Math.PI * this.frequency * t + this.phase);
        }
    }
    
    /**
     * Calculate complete waveform with harmonics and modulation
     */
    updateWaveform() {
        const samplesPerCycle = this.sampleRate / this.frequency;
        const cyclesToShow = Math.max(1, Math.floor(this.bufferSize / samplesPerCycle));
        const timePerSample = 1 / this.sampleRate;
        
        for (let i = 0; i < this.bufferSize; i++) {
            const t = i * timePerSample;
            
            // Base waveform
            let sample = this.generateBaseWaveform(t);
            
            // Add harmonics
            for (const harmonic of this.harmonics) {
                const harmonicFreq = this.frequency * harmonic.multiplier;
                const harmonicPhase = this.phase + (harmonic.phase * Math.PI / 180); // Convert degrees to radians
                sample += harmonic.amplitude * Math.sin(2 * Math.PI * harmonicFreq * t + harmonicPhase);
            }
            
            // Apply amplitude modulation
            if (this.amEnabled) {
                const amValue = 1 + this.amDepth * Math.sin(2 * Math.PI * this.amFreq * t);
                sample *= amValue;
            }
            
            // Apply frequency modulation (implemented as phase modulation)
            if (this.fmEnabled) {
                const fmValue = this.fmDepth * Math.sin(2 * Math.PI * this.fmFreq * t);
                const modPhase = 2 * Math.PI * (this.frequency + fmValue) * t + this.phase;
                sample = this.amplitude * Math.sin(modPhase);
                
                // Add harmonics with FM
                for (const harmonic of this.harmonics) {
                    const harmonicFreq = this.frequency * harmonic.multiplier;
                    const harmonicPhase = this.phase + (harmonic.phase * Math.PI / 180); // Convert degrees to radians
                    const harmonicModPhase = 2 * Math.PI * (harmonicFreq + fmValue) * t + harmonicPhase;
                    sample += harmonic.amplitude * Math.sin(harmonicModPhase);
                }
            } else {
                sample *= this.amplitude;
            }
            
            // Store normalized sample
            this.waveformData[i] = Math.max(-1, Math.min(1, sample));
        }
    }
    
    /**
     * Draw oscilloscope-style grid on canvas
     */
    drawGrid() {
        const ctx = this.ctx;
        // Use stored display dimensions for drawing calculations
        const width = this.canvasDisplayWidth || parseInt(this.canvas.style.width) || this.canvas.width;
        const height = this.canvasDisplayHeight || parseInt(this.canvas.style.height) || this.canvas.height;
        
        // Clear canvas with black background
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, width, height);
        
        // Grid settings
        const gridSpacing = 40; // pixels per division
        const centerY = height * 0.6; // Shifted 20% lower from center
        
        ctx.strokeStyle = '#333333';
        ctx.lineWidth = 1;
        
        // Vertical grid lines
        for (let x = 0; x <= width; x += gridSpacing) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height);
            ctx.stroke();
        }
        
        // Horizontal grid lines
        for (let y = 0; y <= height; y += gridSpacing) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();
        }
        
        // Center lines (brighter)
        ctx.strokeStyle = '#555555';
        ctx.lineWidth = 2;
        
        // Center horizontal line
        ctx.beginPath();
        ctx.moveTo(0, centerY);
        ctx.lineTo(width, centerY);
        ctx.stroke();
        
        // Center vertical line
        const centerX = width / 2;
        ctx.beginPath();
        ctx.moveTo(centerX, 0);
        ctx.lineTo(centerX, height);
        ctx.stroke();
    }
    
    /**
     * Draw the waveform on canvas with oscilloscope-style visualization
     */
    drawWaveform() {
        const ctx = this.ctx;
        // Use stored display dimensions for drawing calculations
        const width = this.canvasDisplayWidth || parseInt(this.canvas.style.width) || this.canvas.width;
        const height = this.canvasDisplayHeight || parseInt(this.canvas.style.height) || this.canvas.height;
        const centerY = height * 0.6; // Shifted 20% lower from center
        
        // Draw grid first
        this.drawGrid();
        
        // Calculate time range to display
        const pixelsPerDivision = 40;
        const divisionsX = width / pixelsPerDivision;
        const timePerDivision = this.timeScale / 1000; // Convert ms to seconds
        const totalTime = divisionsX * timePerDivision;
        
        // Draw waveform with smooth interpolation
        ctx.strokeStyle = '#00ff41';
        ctx.lineWidth = 2;
        ctx.shadowColor = '#00ff41';
        ctx.shadowBlur = 3;
        
        ctx.beginPath();
        
        let firstPoint = true;
        for (let x = 0; x < width; x++) {
            const t = (x / width) * totalTime;
            
            // Calculate sample value directly from time for smooth display
            let sample = this.generateBaseWaveform(t);
            
            // Add harmonics
            for (const harmonic of this.harmonics) {
                const harmonicPhase = this.phase + (harmonic.phase * Math.PI / 180);
                sample += harmonic.amplitude * Math.sin(2 * Math.PI * this.frequency * harmonic.multiplier * t + harmonicPhase);
            }
            
            // Apply modulation if enabled
            if (this.amEnabled) {
                const amValue = 1 + this.amDepth * Math.sin(2 * Math.PI * this.amFreq * t);
                sample *= amValue;
            }
            
            if (this.fmEnabled) {
                const fmValue = this.fmDepth * Math.sin(2 * Math.PI * this.fmFreq * t);
                const modPhase = 2 * Math.PI * (this.frequency + fmValue) * t + this.phase;
                sample = this.amplitude * Math.sin(modPhase);
                
                // Add harmonics with FM
                for (const harmonic of this.harmonics) {
                    const harmonicFreq = this.frequency * harmonic.multiplier;
                    const harmonicPhase = this.phase + (harmonic.phase * Math.PI / 180);
                    const harmonicModPhase = 2 * Math.PI * (harmonicFreq + fmValue) * t + harmonicPhase;
                    sample += harmonic.amplitude * Math.sin(harmonicModPhase);
                }
            } else {
                sample *= this.amplitude;
            }
            
            // Scale amplitude based on amplitude scale
            const scaledSample = sample / this.ampScale;
            const y = centerY - (scaledSample * (height * 0.4));
            
            if (firstPoint) {
                ctx.moveTo(x, y);
                firstPoint = false;
            } else {
                ctx.lineTo(x, y);
            }
        }
        
        ctx.stroke();
        ctx.shadowBlur = 0; // Reset shadow
        
        // Draw measurement indicators
        this.drawMeasurements();
    }
    
    /**
     * Draw measurement indicators and values on the display
     */
    drawMeasurements() {
        // All measurement displays removed for cleaner oscilloscope view
    }
    
    /**
     * Start continuous visualization animation
     */
    startVisualization() {
        const animate = () => {
            this.drawWaveform();
            this.animationId = requestAnimationFrame(animate);
        };
        animate();
    }
    
    /**
     * Setup canvas resizing for responsive layout
     */
    setupCanvasResize() {
        let resizeTimeout;
        let lastWidth = 0;
        let lastHeight = 0;
        let resizeCount = 0;
        
        const resizeCanvas = () => {
            // Debounce to prevent infinite resize loops
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                // Reset resize count after a period of stability
                if (resizeCount > 5) {
                    console.warn('Canvas resize loop detected, stopping resize');
                    return;
                }
                
                // Get canvas container size
                const container = this.canvas.parentElement;
                const containerRect = container.getBoundingClientRect();
                
                // Use container size or CSS-defined size from the canvas element
                const canvasStyle = getComputedStyle(this.canvas);
                const targetWidth = Math.floor(containerRect.width) || parseInt(canvasStyle.width, 10) || 800;
                const targetHeight = parseInt(canvasStyle.height, 10) || 300;
                
                // Check if dimensions actually changed significantly (avoid 1px fluctuations)
                const widthChanged = Math.abs(targetWidth - lastWidth) > 2;
                const heightChanged = Math.abs(targetHeight - lastHeight) > 2;
                
                if (widthChanged || heightChanged) {
                    // Limit pixel ratio for better performance on mobile
                    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
                    
                    // Calculate canvas dimensions with pixel ratio
                    const canvasWidth = Math.floor(targetWidth * pixelRatio);
                    const canvasHeight = Math.floor(targetHeight * pixelRatio);
                    
                    // Only resize if internal dimensions need to change
                    if (this.canvas.width !== canvasWidth || this.canvas.height !== canvasHeight) {
                        // Set canvas internal dimensions for drawing
                        this.canvas.width = canvasWidth;
                        this.canvas.height = canvasHeight;
                        
                        // Ensure CSS size matches what we expect
                        this.canvas.style.width = targetWidth + 'px';
                        this.canvas.style.height = targetHeight + 'px';
                        
                        // Scale the drawing context to match pixel ratio
                        this.ctx.setTransform(1, 0, 0, 1, 0, 0); // Reset transforms
                        this.ctx.scale(pixelRatio, pixelRatio);
                        
                        // Store CSS dimensions for drawing calculations
                        this.canvasDisplayWidth = targetWidth;
                        this.canvasDisplayHeight = targetHeight;
                        this.pixelRatio = pixelRatio;
                        
                        // Update tracking variables
                        lastWidth = targetWidth;
                        lastHeight = targetHeight;
                        resizeCount++;
                        
                        console.log(`Canvas resized: ${targetWidth}x${targetHeight} (CSS) -> ${canvasWidth}x${canvasHeight} (internal), ratio: ${pixelRatio}`);
                        
                        // Redraw the waveform
                        this.drawWaveform();
                        
                        // Update video sizing for responsive behavior
                        if (this.handGestures) {
                            this.handGestures.updateVideoSizing();
                        }
                        
                        // Ensure overlays maintain perfect coverage
                        this.updateOverlayCoverage();
                        
                        // Reset counter after successful resize
                        setTimeout(() => { resizeCount = 0; }, 1000);
                    }
                }
            }, 100); // Increased debounce time for mobile
        };
        
        // Use window resize listener to avoid ResizeObserver feedback loops
        window.addEventListener('resize', resizeCanvas);
        
        // Add orientation change listener for mobile devices
        window.addEventListener('orientationchange', () => {
            setTimeout(resizeCanvas, 100);
        });
        
        // Initial resize after layout stabilizes
        setTimeout(() => {
            resizeCanvas();
            // Also ensure initial overlay coverage
            this.updateOverlayCoverage();
        }, 200);
        
        // Setup touch interactions for mobile
        this.setupMobileInteractions();
    }
    
    /**
     * Update overlay coverage to ensure exact video area coverage
     */
    updateOverlayCoverage() {
        const videoSection = document.getElementById('video-section');
        if (!videoSection) return;
        
        // Get all overlay elements that need to maintain perfect coverage
        const overlays = [
            document.getElementById('video-overlay'),
            document.querySelector('.keyboard-overlay'),
            document.getElementById('video-controls')
        ].filter(element => element !== null);
        
        // Get the video element to match its actual dimensions if visible
        const video = this.handGestures ? this.handGestures.getVideoElement() : null;
        
        // Ensure each overlay perfectly covers its intended area
        overlays.forEach(overlay => {
            if (overlay) {
                // Force recalculation of dimensions
                overlay.style.width = '';
                overlay.style.height = '';
                overlay.style.position = '';
                overlay.style.top = '';
                overlay.style.left = '';
                overlay.style.bottom = '';
                overlay.style.transform = '';
                
                // Trigger reflow to ensure proper sizing
                overlay.offsetHeight;
                
                // For video overlays in video mode, match the video element's sizing behavior
                if (video && video.style.display !== 'none' && overlay.closest('#video-overlay')) {
                    // Check if we're in wide screen mode
                    const isWideScreen = window.innerWidth > 768;
                    
                    if (isWideScreen) {
                        // Wide screens: match video sizing (height 100%, width auto)
                        // Get video actual dimensions to match exactly
                        const videoRect = video.getBoundingClientRect();
                        const containerRect = videoSection.getBoundingClientRect();
                        
                        if (overlay.classList.contains('keyboard-overlay')) {
                            // Keyboard overlay: covers bottom 33% of video area, positioned within video bounds
                            overlay.style.position = 'absolute';
                            overlay.style.bottom = '0';
                            overlay.style.left = `${(containerRect.width - videoRect.width) / 2}px`;
                            overlay.style.transform = 'none';
                            overlay.style.height = '33%';
                            overlay.style.width = `${videoRect.width}px`;
                        } else if (overlay.id === 'video-controls') {
                            // Video controls: covers top area with correct height
                            overlay.style.position = 'absolute';
                            overlay.style.top = '0';
                            overlay.style.left = `${(containerRect.width - videoRect.width) / 2}px`;
                            overlay.style.transform = 'none';
                            overlay.style.height = 'auto';
                            overlay.style.minHeight = '60px';
                            overlay.style.width = `${videoRect.width}px`;
                        } else {
                            // Full coverage overlays: match video dimensions exactly
                            overlay.style.position = 'absolute';
                            overlay.style.top = '50%';
                            overlay.style.left = '50%';
                            overlay.style.transform = 'translate(-50%, -50%)';
                            overlay.style.height = `${videoRect.height}px`;
                            overlay.style.width = `${videoRect.width}px`;
                        }
                    } else {
                        // Narrow screens: width 100%, height auto to match video sizing
                        if (overlay.classList.contains('keyboard-overlay')) {
                            // Keyboard overlay: position at bottom
                            overlay.style.position = 'absolute';
                            overlay.style.bottom = '0';
                            overlay.style.left = '0';
                            overlay.style.right = '0';
                            overlay.style.width = '100%';
                            overlay.style.height = '33%';
                        } else if (overlay.id === 'video-controls') {
                            // Video controls: position at top with auto height
                            overlay.style.position = 'absolute';
                            overlay.style.top = '0';
                            overlay.style.left = '0';
                            overlay.style.right = '0';
                            overlay.style.width = '100%';
                            overlay.style.height = 'auto';
                            overlay.style.minHeight = '60px';
                        } else {
                            // Full coverage overlays
                            overlay.style.width = '100%';
                            overlay.style.height = 'auto';
                            overlay.style.minHeight = '100%';
                        }
                    }
                } else {
                    // Standard overlay sizing for oscilloscope mode
                    if (overlay.classList.contains('keyboard-overlay')) {
                        // Keyboard overlay covers bottom 33%
                        overlay.style.position = 'absolute';
                        overlay.style.bottom = '0';
                        overlay.style.left = '0';
                        overlay.style.right = '0';
                        overlay.style.width = '100%';
                        overlay.style.height = '33%';
                    } else if (overlay.id === 'video-controls') {
                        // Video controls cover top 20%
                        overlay.style.position = 'absolute';
                        overlay.style.top = '0';
                        overlay.style.left = '0';
                        overlay.style.right = '0';
                        overlay.style.width = '100%';
                        overlay.style.height = '20%';
                    } else {
                        // Full coverage overlays
                        overlay.style.width = '100%';
                        overlay.style.height = '100%';
                    }
                }
            }
        });
    }

    /**
     * Setup mobile-specific interactions
     */
    setupMobileInteractions() {
        // Prevent zoom on double tap for canvas and controls
        const preventZoom = (e) => {
            if (e.touches && e.touches.length > 1) {
                e.preventDefault();
            }
        };
        
        // Add touch event listeners
        document.addEventListener('touchstart', preventZoom, { passive: false });
        document.addEventListener('touchmove', preventZoom, { passive: false });
        
        // Improve slider responsiveness on mobile
        const sliders = document.querySelectorAll('input[type="range"]');
        sliders.forEach(slider => {
            slider.addEventListener('touchstart', (e) => {
                e.stopPropagation();
            });
            
            slider.addEventListener('touchmove', (e) => {
                e.stopPropagation();
            });
        });
        
        // Add mobile-friendly button interactions
        const buttons = document.querySelectorAll('.btn');
        buttons.forEach(button => {
            button.addEventListener('touchstart', function() {
                this.style.transform = 'translateY(0px) scale(0.98)';
            });
            
            button.addEventListener('touchend', function() {
                this.style.transform = '';
            });
        });
    }
    
    /**
     * Toggle playback on/off
     */
    async togglePlayback(force = null) {
        if (this.isPlaying || force === 'off') {
            this.stopAudio();
        } else {
            await this.startAudio();
        }
    }
    
    /**
     * Initialize and start continuous audio playback
     */
    async startAudio() {
        try {
            // Initialize audio context if needed
            if (!this.audioContext) {
                this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            }
            
            if (this.audioContext.state === 'suspended') {
                await this.audioContext.resume();
            }
            
            // Create master gain node for volume control
            this.masterGainNode = this.audioContext.createGain();
            this.masterGainNode.gain.value = this.volume;
            this.masterGainNode.connect(this.audioContext.destination);
            
            // Create main oscillator
            this.createMainOscillator();
            
            // Create harmonic oscillators
            this.createHarmonicOscillators();
            
            // Create modulation oscillators if enabled
            this.createModulationOscillators();
            
            // Connect everything
            this.connectAudioNodes();
            
            // Start all oscillators
            const now = this.audioContext.currentTime;
            this.startAllOscillators(now);
            
            this.isPlaying = true;
            
            // Update UI
            document.getElementById('playStopBtn').textContent = '⏹';
            document.getElementById('playStopBtn').classList.add('playing');
            
        } catch (error) {
            console.error('Error starting audio:', error);
            this.showToast('Error starting audio. Please check your browser\'s audio permissions.', 'error');
        }
    }
    
    /**
     * Stop audio playback and disconnect all nodes
     */
    stopAudio() {
        this.isPlaying = false;
        
        // Stop and disconnect main oscillator
        if (this.mainOscillator) {
            this.mainOscillator.stop();
            this.mainOscillator.disconnect();
            this.mainOscillator = null;
        }
        
        // Stop and disconnect harmonic oscillators
        this.harmonicOscillators.forEach(osc => {
            if (osc.oscillator) {
                osc.oscillator.stop();
                osc.oscillator.disconnect();
            }
            if (osc.delayNode) {
                osc.delayNode.disconnect();
            }
            if (osc.gainNode) {
                osc.gainNode.disconnect();
            }
        });
        this.harmonicOscillators = [];
        
        // Stop and disconnect modulation oscillators
        if (this.amOscillator) {
            this.amOscillator.stop();
            this.amOscillator.disconnect();
            this.amOscillator = null;
        }
        
        if (this.fmOscillator) {
            this.fmOscillator.stop();
            this.fmOscillator.disconnect();
            this.fmOscillator = null;
        }
        
        // Disconnect gain nodes
        if (this.gainNode) {
            this.gainNode.disconnect();
            this.gainNode = null;
        }
        
        if (this.amGainNode) {
            this.amGainNode.disconnect();
            this.amGainNode = null;
        }
        
        if (this.masterGainNode) {
            this.masterGainNode.disconnect();
            this.masterGainNode = null;
        }
        
        // Update UI
        document.getElementById('playStopBtn').textContent = '▶';
        document.getElementById('playStopBtn').classList.remove('playing');
    }
    
    /**
     * Create the main oscillator with current waveform type
     */
    createMainOscillator() {
        this.mainOscillator = this.audioContext.createOscillator();
        this.gainNode = this.audioContext.createGain();
        
        // Set frequency and amplitude
        this.mainOscillator.frequency.value = this.frequency;
        this.gainNode.gain.value = this.amplitude;
        
        // Set waveform type or create custom wave
        this.setOscillatorWaveform(this.mainOscillator, this.waveType);
        
        // Connect main oscillator through gain node
        this.mainOscillator.connect(this.gainNode);
    }
    
    /**
     * Create oscillators for each harmonic
     */
    createHarmonicOscillators() {
        this.harmonicOscillators = [];
        
        for (const harmonic of this.harmonics) {
            if (harmonic.phase === 0) {
                // Simple oscillator for zero phase
                const oscillator = this.audioContext.createOscillator();
                const gainNode = this.audioContext.createGain();
                
                oscillator.frequency.value = this.frequency * harmonic.multiplier;
                gainNode.gain.value = harmonic.amplitude;
                oscillator.type = 'sine';
                
                oscillator.connect(gainNode);
                
                this.harmonicOscillators.push({
                    oscillator: oscillator,
                    gainNode: gainNode,
                    harmonicData: harmonic,
                    delayNode: null
                });
            } else {
                // Use delay node to create phase shift
                const oscillator = this.audioContext.createOscillator();
                const gainNode = this.audioContext.createGain();
                const delayNode = this.audioContext.createDelay(1.0);
                
                oscillator.frequency.value = this.frequency * harmonic.multiplier;
                gainNode.gain.value = harmonic.amplitude;
                oscillator.type = 'sine';
                
                // Calculate delay time for phase shift
                const period = 1 / (this.frequency * harmonic.multiplier);
                const phaseDelay = (harmonic.phase / 360) * period;
                delayNode.delayTime.value = Math.max(0, phaseDelay);
                
                oscillator.connect(delayNode);
                delayNode.connect(gainNode);
                
                this.harmonicOscillators.push({
                    oscillator: oscillator,
                    gainNode: gainNode,
                    harmonicData: harmonic,
                    delayNode: delayNode
                });
            }
        }
    }
    
    /**
     * Create modulation oscillators if enabled
     */
    createModulationOscillators() {
        if (this.amEnabled) {
            this.amOscillator = this.audioContext.createOscillator();
            this.amGainNode = this.audioContext.createGain();
            
            this.amOscillator.frequency.value = this.amFreq;
            this.amOscillator.type = 'sine';
            
            // Set up amplitude modulation depth
            this.amGainNode.gain.value = this.amDepth;
            this.amOscillator.connect(this.amGainNode);
        }
        
        if (this.fmEnabled) {
            this.fmOscillator = this.audioContext.createOscillator();
            this.fmOscillator.frequency.value = this.fmFreq;
            this.fmOscillator.type = 'sine';
            
            // Connect FM oscillator to main oscillator frequency
            const fmGain = this.audioContext.createGain();
            fmGain.gain.value = this.fmDepth;
            this.fmOscillator.connect(fmGain);
            fmGain.connect(this.mainOscillator.frequency);
        }
    }
    
    /**
     * Connect all audio nodes together
     */
    connectAudioNodes() {
        // Connect main oscillator and harmonics to master gain
        if (this.amEnabled && this.amGainNode) {
            // Apply amplitude modulation
            this.amGainNode.connect(this.gainNode.gain);
            this.gainNode.connect(this.masterGainNode);
        } else {
            this.gainNode.connect(this.masterGainNode);
        }
        
        // Connect harmonic oscillators
        this.harmonicOscillators.forEach(harmonic => {
            if (this.amEnabled && this.amGainNode) {
                // Apply AM to harmonics too
                this.amGainNode.connect(harmonic.gainNode.gain);
            }
            harmonic.gainNode.connect(this.masterGainNode);
        });
    }
    
    /**
     * Start all oscillators at the same time for phase coherence
     */
    startAllOscillators(startTime) {
        this.mainOscillator.start(startTime);
        
        this.harmonicOscillators.forEach(harmonic => {
            harmonic.oscillator.start(startTime);
        });
        
        if (this.amOscillator) {
            this.amOscillator.start(startTime);
        }
        
        if (this.fmOscillator) {
            this.fmOscillator.start(startTime);
        }
    }
    
    /**
     * Set oscillator waveform type or create custom periodic wave
     */
    setOscillatorWaveform(oscillator, waveType) {
        if (waveType === 'custom') {
            // Create custom periodic wave similar to the complex waveform
            const real = new Float32Array(8);
            const imag = new Float32Array(8);
            
            // Fundamental
            real[1] = 0.8;
            // 3rd harmonic
            real[3] = 0.4;
            // 5th harmonic
            real[5] = 0.2;
            // 7th harmonic
            real[7] = 0.1;
            
            const customWave = this.audioContext.createPeriodicWave(real, imag);
            oscillator.setPeriodicWave(customWave);
        } else if (waveType === 'square' && this.smoothing > 0.01) {
            // Create custom smoothed square wave for audio
            this.createSmoothedSquareWave(oscillator);
        } else {
            oscillator.type = waveType;
        }
    }
    
    /**
     * Create a custom periodic wave for smoothed square wave
     */
    createSmoothedSquareWave(oscillator) {
        const harmonics = 32; // Number of harmonics to calculate
        const real = new Float32Array(harmonics);
        const imag = new Float32Array(harmonics);
        
        // Generate waveform samples
        const samples = 1024;
        const waveformSamples = new Float32Array(samples);
        
        for (let i = 0; i < samples; i++) {
            const t = i / samples; // 0 to 1 representing one full cycle
            const dutyCycleRatio = this.dutyCycle / 100; // Convert percentage to ratio
            const maxRiseTime = dutyCycleRatio * 0.5; // Max rise time is 50% of duty cycle width
            const riseTime = Math.min(this.smoothing * 0.5, maxRiseTime); // Limit rise time
            
            if (t < riseTime) {
                // Smooth rising edge
                const riseProgress = t / riseTime;
                const smoothedRise = 1 - Math.exp(-5 * riseProgress);
                waveformSamples[i] = -1 + 2 * smoothedRise;
            } else if (t < dutyCycleRatio) {
                // High plateau - duration controlled by duty cycle
                waveformSamples[i] = 1;
            } else {
                // Instant falling edge and low plateau
                waveformSamples[i] = -1;
            }
        }
        
        // Calculate Fourier coefficients from the samples
        for (let h = 1; h < harmonics; h++) {
            let realSum = 0;
            let imagSum = 0;
            
            for (let n = 0; n < samples; n++) {
                const angle = 2 * Math.PI * h * n / samples;
                realSum += waveformSamples[n] * Math.cos(angle);
                imagSum += waveformSamples[n] * Math.sin(angle);
            }
            
            real[h] = (2 / samples) * realSum;
            imag[h] = -(2 / samples) * imagSum;
        }
        
        const customWave = this.audioContext.createPeriodicWave(real, imag);
        oscillator.setPeriodicWave(customWave);
    }
    
    /**
     * Update audio frequency in real-time
     */
    updateAudioFrequency() {
        if (this.isPlaying && this.mainOscillator) {
            this.mainOscillator.frequency.setValueAtTime(this.frequency, this.audioContext.currentTime);
            
            // Update harmonic frequencies
            this.harmonicOscillators.forEach(harmonic => {
                const newFreq = this.frequency * harmonic.harmonicData.multiplier;
                harmonic.oscillator.frequency.setValueAtTime(newFreq, this.audioContext.currentTime);
            });
        }
    }
    
    /**
     * Update audio amplitude in real-time
     */
    updateAudioAmplitude() {
        if (this.isPlaying && this.gainNode) {
            this.gainNode.gain.setValueAtTime(this.amplitude, this.audioContext.currentTime);
        }
    }
    
    /**
     * Update audio volume in real-time
     */
    updateAudioVolume() {
        if (this.isPlaying && this.masterGainNode) {
            this.masterGainNode.gain.setValueAtTime(this.volume, this.audioContext.currentTime);
        }
    }
    
    /**
     * Update waveform type in real-time (requires recreating oscillator)
     */
    updateAudioWaveType() {
        if (this.isPlaying) {
            // For waveform type changes, we need to restart the audio
            // This ensures smooth transition
            const wasPlaying = this.isPlaying;
            this.stopAudio();
            if (wasPlaying) {
                setTimeout(() => this.startAudio(), 10);
            }
        }
    }
    
    /**
     * Update harmonics in real-time
     */
    updateAudioHarmonics() {
        if (this.isPlaying) {
            // Stop existing harmonic oscillators
            this.harmonicOscillators.forEach(harmonic => {
                if (harmonic.oscillator) {
                    harmonic.oscillator.stop();
                    harmonic.oscillator.disconnect();
                }
                if (harmonic.delayNode) {
                    harmonic.delayNode.disconnect();
                }
                if (harmonic.gainNode) {
                    harmonic.gainNode.disconnect();
                }
            });
            
            // Recreate harmonic oscillators
            this.createHarmonicOscillators();
            
            // Reconnect and start new harmonics
            this.harmonicOscillators.forEach(harmonic => {
                if (this.amEnabled && this.amGainNode) {
                    this.amGainNode.connect(harmonic.gainNode.gain);
                }
                harmonic.gainNode.connect(this.masterGainNode);
                harmonic.oscillator.start();
            });
        }
    }
    
    /**
     * Update modulation in real-time
     */
    updateAudioModulation() {
        if (this.isPlaying) {
            // For modulation changes, restart audio for clean transition
            const wasPlaying = this.isPlaying;
            this.stopAudio();
            if (wasPlaying) {
                setTimeout(() => this.startAudio(), 10);
                         }
         }
     }
     
     /**
      * Get current synthesizer state for saving
      */
     getCurrentState() {
         return {
             // Basic parameters
             frequency: this.frequency,
             amplitude: this.amplitude,
             waveType: this.waveType,
             phase: this.phase * 180 / Math.PI, // Convert back to degrees
             volume: this.volume,
             smoothing: this.smoothing,
             dutyCycle: this.dutyCycle,
             
             // Harmonics
             harmonics: this.harmonics.map(h => ({
                 multiplier: h.multiplier,
                 amplitude: h.amplitude,
                 phase: h.phase
             })),
             
             // Modulation
             amEnabled: this.amEnabled,
             amFreq: this.amFreq,
             amDepth: this.amDepth,
             fmEnabled: this.fmEnabled,
             fmFreq: this.fmFreq,
             fmDepth: this.fmDepth,
             
             // Display
             timeScale: this.timeScale,
             ampScale: this.ampScale
         };
     }
     
     /**
      * Apply state to synthesizer
      */
     applyState(state) {
         // Stop audio if playing
         if (this.isPlaying) {
             this.stopAudio();
         }
         
         // Clear existing harmonics
         this.harmonics = [];
         document.getElementById('harmonicsContainer').innerHTML = '';
         this.harmonicCounter = 0;
         
         // Apply basic parameters
         this.frequency = state.frequency || 440;
         this.amplitude = state.amplitude || 0.5;
         this.waveType = state.waveType || 'sine';
         this.phase = (state.phase || 0) * Math.PI / 180; // Convert to radians
         this.volume = state.volume || 0.5;
         this.smoothing = state.smoothing || 0.1;
         this.dutyCycle = state.dutyCycle || 50;
         
         // Apply modulation
         this.amEnabled = state.amEnabled || false;
         this.amFreq = state.amFreq || 5;
         this.amDepth = state.amDepth || 0.5;
         this.fmEnabled = state.fmEnabled || false;
         this.fmFreq = state.fmFreq || 5;
         this.fmDepth = state.fmDepth || 50;
         
         // Apply display settings
         this.timeScale = state.timeScale || 1.0;
         this.ampScale = state.ampScale || 1.0;
         
         // Update UI controls
         this.updateUIFromState();
         
         // Recreate harmonics
         if (state.harmonics && state.harmonics.length > 0) {
             state.harmonics.forEach(harmonic => {
                 this.addHarmonicFromData(harmonic);
             });
         }
         
         // Rebuild all harmonic UI elements
         this.rebuildAllHarmonics();
         
         this.updateWaveform();
     }
     
     /**
      * Update UI controls to match current state
      */
     updateUIFromState() {
         // Update sliders and displays
         document.getElementById('frequency').value = this.frequency;
         document.getElementById('freqValue').textContent = this.frequency.toFixed(0);
         
         document.getElementById('amplitude').value = this.amplitude;
         document.getElementById('ampValue').textContent = this.amplitude.toFixed(2);
         
         document.getElementById('waveType').value = this.waveType;
         
         document.getElementById('phase').value = this.phase * 180 / Math.PI;
         document.getElementById('phaseValue').textContent = (this.phase * 180 / Math.PI).toFixed(0);
         
         document.getElementById('smoothing').value = this.smoothing;
         document.getElementById('smoothingValue').textContent = this.smoothing.toFixed(2);
         
         document.getElementById('dutyCycle').value = this.dutyCycle;
         document.getElementById('dutyCycleValue').textContent = this.dutyCycle.toFixed(0);
         
         document.getElementById('volume').value = this.volume * 100;
         
         // Modulation controls
         document.getElementById('enableAM').checked = this.amEnabled;
         document.getElementById('amFreq').value = this.amFreq;
         document.getElementById('amFreqValue').textContent = this.amFreq.toFixed(2);
         document.getElementById('amDepth').value = this.amDepth;
         document.getElementById('amDepthValue').textContent = this.amDepth.toFixed(2);
         
         document.getElementById('enableFM').checked = this.fmEnabled;
         document.getElementById('fmFreq').value = this.fmFreq;
         document.getElementById('fmFreqValue').textContent = this.fmFreq.toFixed(2);
         document.getElementById('fmDepth').value = this.fmDepth;
         document.getElementById('fmDepthValue').textContent = this.fmDepth.toFixed(0);
         
         // Display controls
         document.getElementById('timeScale').value = this.timeScale;
         document.getElementById('timeScaleValue').textContent = this.timeScale.toFixed(2);
         document.getElementById('ampScale').value = this.ampScale;
         document.getElementById('ampScaleValue').textContent = this.ampScale.toFixed(2);
         
         // Update square wave controls visibility
         this.updateSquareWaveControls();
     }
     
     /**
      * Add harmonic from saved data
      */
     addHarmonicFromData(harmonicData) {
         // Add to harmonics array
         this.harmonics.push({
             multiplier: harmonicData.multiplier,
             amplitude: harmonicData.amplitude,
             phase: harmonicData.phase
         });
     }
     
     /**
      * Save current preset to localStorage
      */
     savePreset() {
         const presetName = document.getElementById('presetName').value.trim();
         if (!presetName) {
             this.showToast('Please enter a preset name', 'warning');
             return;
         }
         
         const presets = JSON.parse(localStorage.getItem('waveformPresets') || '{}');
         presets[presetName] = this.getCurrentState();
         localStorage.setItem('waveformPresets', JSON.stringify(presets));
         
         this.updatePresetSelect();
         document.getElementById('presetName').value = '';
         
         this.showToast(`Preset "${presetName}" saved successfully!`, 'success');
     }
     
     /**
      * Load selected preset
      */
     loadPreset() {
         const presetName = document.getElementById('presetSelect').value;
         if (!presetName) {
             this.showToast('Please select a preset to load', 'warning');
             return;
         }
         
         const presets = JSON.parse(localStorage.getItem('waveformPresets') || '{}');
         if (presets[presetName]) {
             this.applyState(presets[presetName]);
             this.showToast(`Preset "${presetName}" loaded!`, 'success');
         }
     }
     
     /**
      * Delete selected preset
      */
     deletePreset() {
         const presetName = document.getElementById('presetSelect').value;
         if (!presetName) {
             this.showToast('Please select a preset to delete', 'warning');
             return;
         }
         
         if (!confirm(`Are you sure you want to delete preset "${presetName}"?`)) {
             return;
         }
         
         const presets = JSON.parse(localStorage.getItem('waveformPresets') || '{}');
         delete presets[presetName];
         localStorage.setItem('waveformPresets', JSON.stringify(presets));
         
         this.updatePresetSelect();
         this.showToast(`Preset "${presetName}" deleted!`, 'success');
     }
     
     /**
      * Create shareable URL with current settings
      */
     sharePreset() {
         const state = this.getCurrentState();
         const params = new URLSearchParams();
         params.set('preset', btoa(JSON.stringify(state)));
         
         const url = window.location.origin + window.location.pathname + '?' + params.toString();
         
         navigator.clipboard.writeText(url).then(() => {
             this.showToast('Shareable link copied to clipboard!', 'success');
         }).catch(() => {
             prompt('Copy this link to share your preset:', url);
         });
     }
     
     /**
      * Load preset from URL parameters
      */
     loadFromURL() {
         const params = new URLSearchParams(window.location.search);
         const presetData = params.get('preset');
         
         if (presetData) {
             try {
                 const state = JSON.parse(atob(presetData));
                 this.applyState(state);
                 console.log('Preset loaded from URL');
             } catch (error) {
                 console.error('Error loading preset from URL:', error);
             }
         }
     }
     
     /**
      * Load presets from localStorage and populate select
      */
     loadPresetsFromStorage() {
         this.updatePresetSelect();
     }
     
     /**
      * Initialize default presets if they don't exist
      */
     initializeDefaultPresets() {
         const presets = JSON.parse(localStorage.getItem('waveformPresets') || '{}');
         
                 // Create "Simple Sine" preset if it doesn't exist
        if (!presets['Simple Sine']) {
            const simpleSinePreset = {
                frequency: 440,
                amplitude: 0.5,
                waveType: 'sine',
                phase: 0,
                volume: 0.5,
                smoothing: 0.1,
                dutyCycle: 50,
                harmonics: [],
                amEnabled: false,
                amFreq: 5,
                amDepth: 0.5,
                fmEnabled: false,
                fmFreq: 5,
                fmDepth: 50,
                timeScale: 1.0,
                ampScale: 1.0
            };
            presets['Simple Sine'] = simpleSinePreset;
        }
         
         // Create "Stylophone" preset if it doesn't exist
         if (!presets['Stylophone']) {
             const stylophonePreset = {
                 frequency: 440,
                 amplitude: 0.5,
                 waveType: 'square',
                 phase: 0,
                 volume: 0.5,
                 smoothing: 1.0,
                 dutyCycle: 99,
                 harmonics: [
                     {
                         multiplier: 2.0,
                         amplitude: 0.24,
                         phase: 216
                     }
                 ],
                 amEnabled: true,
                 amFreq: 7.0,
                 amDepth: 0.03,
                 fmEnabled: false,
                 fmFreq: 5,
                 fmDepth: 50,
                 timeScale: 1.0,
                 ampScale: 1.0
             };
             presets['Stylophone'] = stylophonePreset;
         }
         
                 // Save updated presets back to localStorage
        localStorage.setItem('waveformPresets', JSON.stringify(presets));
        this.updatePresetSelect();
        
        // Load Stylophone preset by default
        this.applyState(presets['Stylophone']);
     }
     
     /**
      * Update preset select dropdown
      */
     updatePresetSelect() {
         const select = document.getElementById('presetSelect');
         const presets = JSON.parse(localStorage.getItem('waveformPresets') || '{}');
         
         // Clear existing options except the first one
         select.innerHTML = '<option value="">Select preset...</option>';
         
         // Add presets
         Object.keys(presets).sort().forEach(presetName => {
             const option = document.createElement('option');
             option.value = presetName;
             option.textContent = presetName;
             select.appendChild(option);
         });
     }
     
    /**
     * Hide corner buttons when in video mode
     */
    hideCornerButtons() {
        // Hide play corner button
        const playCornerTab = document.querySelector('.play-corner-tab');
        if (playCornerTab) {
            playCornerTab.style.display = 'none';
        }
        
        // Hide video mode corner button
        const gestureCornerTab = document.querySelector('.gesture-corner-tab');
        if (gestureCornerTab) {
            gestureCornerTab.style.display = 'none';
        }
    }
    
    /**
     * Show corner buttons when returning to oscilloscope mode
     */
    showCornerButtons() {
        // Show play corner button
        const playCornerTab = document.querySelector('.play-corner-tab');
        if (playCornerTab) {
            playCornerTab.style.display = '';
        }
        
        // Show video mode corner button
        const gestureCornerTab = document.querySelector('.gesture-corner-tab');
        if (gestureCornerTab) {
            gestureCornerTab.style.display = '';
        }
        
        // Restore attention animation if user hasn't used video mode yet
        if (!this.hasEverUsedVideoMode) {
            this.addAttentionAnimation();
        }
    }
    
    /**
     * Add attention-drawing animation to gesture button for first-time users
     */
    addAttentionAnimation() {
        const gesturePlayBtn = document.getElementById('gesturePlayBtn');
        if (gesturePlayBtn) {
            gesturePlayBtn.classList.add('attention-pulse');
        }
    }
    
    /**
     * Remove attention animation when user enters video mode
     */
    removeAttentionAnimation() {
        const gesturePlayBtn = document.getElementById('gesturePlayBtn');
        if (gesturePlayBtn) {
            gesturePlayBtn.classList.remove('attention-pulse');
        }
    }

 }
 
 // Initialize the waveform generator when the page loads
window.waveformGen = null;
document.addEventListener('DOMContentLoaded', () => {
    window.waveformGen = new WaveformGenerator();
}); 