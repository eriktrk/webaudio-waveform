# Web Audio Waveform Generator

A sophisticated web application for generating, visualizing, and playing custom waveforms using the Web Audio API. Features professional oscilloscope-style visualization, hand gesture controls, and advanced harmonic synthesis.

## Features

### 🎵 Waveform Generation
- **Basic waveforms**: Sine, Square, Sawtooth, Triangle
- **Real-time parameter control**: Frequency (20Hz - 2kHz), Amplitude, Phase
- **Square wave enhancements**: Duty cycle and rise time control

### 🎛️ Advanced Synthesis
- **Harmonic Generation**: Add multiple harmonics with independent frequency multipliers and amplitudes
- **Amplitude Modulation (AM)**: Variable frequency and depth controls
- **Frequency Modulation (FM)**: Create dynamic, evolving waveforms

### 👋 Hand Gesture Control
- **Camera-based control**: Use hand movements to control frequency
- **Pinch gestures**: Play/stop audio with hand gestures
- **Real-time interaction**: Direct hand-to-audio mapping

### 💾 Preset Management
- **Save/Load presets**: Store your custom waveform configurations
- **Share presets**: Generate shareable links with URL encoding
- **Default presets**: Includes "Simple Sine" and "Stylophone" presets

### 📊 Professional Visualization
- **Oscilloscope-style display**: Dark theme with green phosphor-like traces
- **Grid overlay**: Professional measurement grid
- **Adjustable scales**: Time scale (0.1-10 ms/div) and Amplitude scale (0.1-5 V/div)
- **Real-time waveform display**: Live visualization of generated audio

### 🔊 Audio Playback
- **Web Audio API**: High-quality audio synthesis
- **Volume control**: 0-100% with real-time adjustment
- **Instant playback**: Generate and play waveforms on demand

## Usage

1. **Open** `index.html` in a modern web browser
2. **Adjust parameters** using the control panels:
   - Left panel: Fundamental wave settings
   - Right panel: Modulation controls
   - Bottom panel: Harmonic configuration
3. **Hand gestures** (optional): Click the video section to enable camera control
4. **Presets**: Save, load, and share your configurations
5. **Play audio**: Use the play button or hand gestures

## Browser Requirements

- **Chrome**: Version 66+
- **Firefox**: Version 60+
- **Safari**: Version 14+
- **Edge**: Version 79+

**Note**: Camera access required for hand gesture features. Audio requires user interaction due to browser autoplay policies.

## Files

```
webaudio_waveform/
├── index.html          # Main application interface
├── styles.css          # Professional audio-technical styling
├── script.js           # Core application and Web Audio API
├── handGestures.js     # Hand gesture recognition system
├── icon.png            # Application icon
└── README.md           # This documentation
```

## License

This project is open source and available under the MIT License. 
