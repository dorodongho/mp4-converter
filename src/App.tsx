/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import { 
  FileAudio, 
  Upload, 
  X, 
  Download, 
  Loader2, 
  CheckCircle2, 
  AlertCircle,
  Music,
  Video,
  ChevronRight,
  Plus
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// FFmpeg configuration
const FFMPEG_CORE_VERSION = '0.12.6';
const baseURL = `https://unpkg.com/@ffmpeg/core@${FFMPEG_CORE_VERSION}/dist/umd`;

export default function App() {
  const [loaded, setLoaded] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [processing, setProcessing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<string>('Ready');
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  const ffmpegRef = useRef(new FFmpeg());
  const isLoadingRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadFFmpeg();
  }, []);

  const loadFFmpeg = async () => {
    if (loaded || isLoadingRef.current) return;
    
    isLoadingRef.current = true;
    setError(null);
    
    try {
      setStatus('Initializing engine...');
      const ffmpeg = ffmpegRef.current;
      
      ffmpeg.on('log', ({ message }) => {
        console.log('[FFmpeg Log]', message);
      });

      ffmpeg.on('progress', ({ progress }) => {
        setProgress(Math.round(progress * 100));
      });

      // Check for SharedArrayBuffer support
      if (!window.SharedArrayBuffer) {
        console.warn('SharedArrayBuffer is not available.');
      }

      await ffmpeg.load({
        coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
      });
      
      setLoaded(true);
      setStatus('Ready');
    } catch (err) {
      console.error('Failed to load FFmpeg:', err);
      let errorMsg = 'Failed to load the processing engine.';
      
      if (!window.crossOriginIsolated) {
        errorMsg += ' (Cross-Origin Isolation is not enabled. Please try opening the app in a new tab or check browser settings.)';
      } else {
        errorMsg += ' (Network error or slow connection. Please try again.)';
      }
      
      setError(errorMsg);
      setStatus('Error');
    } finally {
      isLoadingRef.current = false;
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files).filter((f: File) => f.name.toLowerCase().endsWith('.m4a'));
      if (newFiles.length === 0 && e.target.files.length > 0) {
        setError('Only .m4a files are supported.');
        return;
      }
      setFiles(prev => [...prev, ...newFiles]);
      setError(null);
      setResultUrl(null);
    }
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const onDragLeave = () => {
    setIsDragging(false);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files) {
      const newFiles = Array.from(e.dataTransfer.files).filter((f: File) => f.name.toLowerCase().endsWith('.m4a'));
      if (newFiles.length === 0 && e.dataTransfer.files.length > 0) {
        setError('Only .m4a files are supported.');
        return;
      }
      setFiles(prev => [...prev, ...newFiles]);
      setError(null);
      setResultUrl(null);
    }
  };

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
    setResultUrl(null);
  };

  const processAudio = async () => {
    if (files.length === 0) return;
    
    setProcessing(true);
    setProgress(0);
    setError(null);
    setResultUrl(null);
    
    const ffmpeg = ffmpegRef.current;
    
    try {
      // 1. Write files to FFmpeg virtual filesystem
      setStatus('Reading files...');
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        await ffmpeg.writeFile(`input_${i}.m4a`, await fetchFile(file));
      }

      let finalAudio = 'merged.mp3';

      if (files.length > 1) {
        // 2. Merge files
        setStatus('Merging audio files...');
        // Create a concat list file
        const concatList = files.map((_, i) => `file 'input_${i}.m4a'`).join('\n');
        await ffmpeg.writeFile('concat_list.txt', concatList);
        
        // Concatenate and convert to mp3 in one go if possible, or merge first
        // We'll merge to a temporary m4a then convert to mp3
        await ffmpeg.exec([
          '-f', 'concat', 
          '-safe', '0', 
          '-i', 'concat_list.txt', 
          '-c', 'copy', 
          'merged_temp.m4a'
        ]);
        
        setStatus('Converting to MP3...');
        await ffmpeg.exec(['-i', 'merged_temp.m4a', '-acodec', 'libmp3lame', '-ab', '192k', 'merged.mp3']);
      } else {
        // Just convert single file to mp3
        setStatus('Converting to MP3...');
        await ffmpeg.exec(['-i', 'input_0.m4a', '-acodec', 'libmp3lame', '-ab', '192k', 'merged.mp3']);
      }

      // 3. Convert MP3 to MP4
      // We'll create a video with a static color background or just a black frame
      // Using a simple black background for the video
      setStatus('Generating MP4 video...');
      await ffmpeg.exec([
        '-f', 'lavfi', 
        '-i', 'color=c=black:s=1280x720:r=24', 
        '-i', 'merged.mp3', 
        '-c:v', 'libx264', 
        '-tune', 'stillimage', 
        '-c:a', 'aac', 
        '-b:a', '192k', 
        '-pix_fmt', 'yuv420p', 
        '-shortest', 
        'output.mp4'
      ]);

      // 4. Read the result
      setStatus('Finalizing...');
      const data = await ffmpeg.readFile('output.mp4');
      const blob = new Blob([data], { type: 'video/mp4' });
      const url = URL.createObjectURL(blob);
      
      setResultUrl(url);
      setStatus('Completed');
      
      // Cleanup virtual FS
      for (let i = 0; i < files.length; i++) {
        await ffmpeg.deleteFile(`input_${i}.m4a`);
      }
      if (files.length > 1) {
        await ffmpeg.deleteFile('concat_list.txt');
        await ffmpeg.deleteFile('merged_temp.m4a');
      }
      await ffmpeg.deleteFile('merged.mp3');
      await ffmpeg.deleteFile('output.mp4');

    } catch (err) {
      console.error('Processing error:', err);
      setError('An error occurred during processing. Please try again.');
      setStatus('Error');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-[#e0e0e0] font-sans selection:bg-orange-500/30">
      {/* Background Decoration */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none opacity-20">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-orange-600 blur-[120px] rounded-full" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-600 blur-[120px] rounded-full" />
      </div>

      <main className="relative z-10 max-w-4xl mx-auto px-6 py-12">
        {/* Header */}
        <header className="mb-12">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-3 mb-4"
          >
            <div className="p-2 bg-orange-500 rounded-lg">
              <Music className="w-6 h-6 text-black" />
            </div>
            <h1 className="text-3xl font-bold tracking-tight">Audio Processor</h1>
          </motion.div>
          <p className="text-gray-400 max-w-xl">
            Merge multiple M4A files, convert them to high-quality MP3, and export as a single MP4 video. 
            All processing happens locally in your browser.
          </p>
        </header>

        {/* Main Interface */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {/* Left Column: Upload & List */}
          <div className="md:col-span-2 space-y-6">
            <section className="bg-[#151619] border border-[#2a2a2a] rounded-2xl overflow-hidden">
              <div className="p-6 border-bottom border-[#2a2a2a] flex justify-between items-center">
                <h2 className="font-semibold flex items-center gap-2">
                  <Upload className="w-4 h-4 text-orange-500" />
                  Upload M4A Files
                </h2>
                <span className="text-xs font-mono text-gray-500 uppercase tracking-widest">
                  {files.length} Files
                </span>
              </div>

              <div className="p-6">
                <div 
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={onDragOver}
                  onDragLeave={onDragLeave}
                  onDrop={onDrop}
                  className={`group relative border-2 border-dashed rounded-xl p-10 transition-all cursor-pointer ${
                    isDragging 
                      ? 'border-orange-500 bg-orange-500/5' 
                      : 'border-[#333] hover:border-orange-500/50 bg-[#0d0e10]'
                  }`}
                >
                  <input 
                    type="file" 
                    ref={fileInputRef}
                    onChange={handleFileChange}
                    multiple 
                    accept=".m4a"
                    className="hidden"
                  />
                  <div className="flex flex-col items-center text-center">
                    <div className="w-12 h-12 bg-[#1a1b1e] rounded-full flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                      <Plus className="w-6 h-6 text-gray-400 group-hover:text-orange-500" />
                    </div>
                    <p className="text-sm font-medium text-gray-300">Click or drag files to upload</p>
                    <p className="text-xs text-gray-500 mt-1">Supports .m4a audio files</p>
                  </div>
                </div>

                {/* File List */}
                <div className="mt-6 space-y-2 max-h-[300px] overflow-y-auto custom-scrollbar">
                  <AnimatePresence mode="popLayout">
                    {files.map((file, index) => (
                      <motion.div
                        key={`${file.name}-${index}`}
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        className="flex items-center justify-between p-3 bg-[#1a1b1e] border border-[#2a2a2a] rounded-lg group"
                      >
                        <div className="flex items-center gap-3 overflow-hidden">
                          <div className="p-2 bg-[#25262b] rounded text-orange-500">
                            <FileAudio className="w-4 h-4" />
                          </div>
                          <div className="overflow-hidden">
                            <p className="text-sm font-medium truncate">{file.name}</p>
                            <p className="text-[10px] font-mono text-gray-500">{(file.size / (1024 * 1024)).toFixed(2)} MB</p>
                          </div>
                        </div>
                        <button 
                          onClick={() => removeFile(index)}
                          className="p-1.5 text-gray-500 hover:text-red-400 hover:bg-red-400/10 rounded-md transition-colors"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                  
                  {files.length === 0 && (
                    <div className="text-center py-8 text-gray-600 italic text-sm">
                      No files uploaded yet
                    </div>
                  )}
                </div>
              </div>
            </section>
          </div>

          {/* Right Column: Controls & Result */}
          <div className="space-y-6">
            <section className="bg-[#151619] border border-[#2a2a2a] rounded-2xl p-6">
              <h2 className="font-semibold mb-6 flex items-center gap-2">
                <Loader2 className={`w-4 h-4 text-blue-500 ${processing ? 'animate-spin' : ''}`} />
                Processing
              </h2>

              <div className="space-y-6">
                {/* Status Indicator */}
                <div className="p-4 bg-[#0d0e10] rounded-xl border border-[#2a2a2a]">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-[10px] font-mono uppercase tracking-widest text-gray-500">Status</span>
                    <span className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded ${
                      status === 'Completed' ? 'bg-green-500/10 text-green-500' : 
                      status === 'Error' ? 'bg-red-500/10 text-red-500' : 
                      'bg-blue-500/10 text-blue-500'
                    }`}>
                      {status}
                    </span>
                  </div>
                  <p className="text-sm font-medium truncate">{status === 'Ready' && files.length > 0 ? 'Ready to process' : status}</p>
                  
                  {processing && (
                    <div className="mt-4 space-y-2">
                      <div className="h-1.5 w-full bg-[#25262b] rounded-full overflow-hidden">
                        <motion.div 
                          className="h-full bg-orange-500"
                          initial={{ width: 0 }}
                          animate={{ width: `${progress}%` }}
                        />
                      </div>
                      <div className="flex justify-between text-[10px] font-mono text-gray-500">
                        <span>Progress</span>
                        <span>{progress}%</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Action Button */}
                <button
                  disabled={!loaded || processing || files.length === 0}
                  onClick={processAudio}
                  className={`w-full py-4 rounded-xl font-bold flex items-center justify-center gap-2 transition-all ${
                    !loaded || processing || files.length === 0
                      ? 'bg-[#25262b] text-gray-600 cursor-not-allowed'
                      : 'bg-orange-500 text-black hover:bg-orange-400 active:scale-[0.98] shadow-lg shadow-orange-500/20'
                  }`}
                >
                  {processing ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    <>
                      <Video className="w-5 h-5" />
                      Merge & Export MP4
                    </>
                  )}
                </button>

                {error && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex flex-col gap-2 text-red-400 text-xs"
                  >
                    <div className="flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <p>{error}</p>
                    </div>
                    {status === 'Error' && (
                      <button 
                        onClick={() => {
                          setError(null);
                          loadFFmpeg();
                        }}
                        className="mt-2 text-[10px] uppercase tracking-widest font-bold text-white bg-red-500/20 hover:bg-red-500/40 py-1 px-2 rounded self-start"
                      >
                        Retry Loading Engine
                      </button>
                    )}
                  </motion.div>
                )}

                {/* Result */}
                {resultUrl && (
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="space-y-4 pt-4 border-t border-[#2a2a2a]"
                  >
                    <div className="aspect-video bg-black rounded-lg overflow-hidden border border-[#333] relative group">
                      <video 
                        src={resultUrl} 
                        controls 
                        className="w-full h-full object-contain"
                      />
                      <div className="absolute top-2 right-2">
                        <div className="bg-green-500 p-1 rounded-full shadow-lg">
                          <CheckCircle2 className="w-4 h-4 text-black" />
                        </div>
                      </div>
                    </div>
                    
                    <a
                      href={resultUrl}
                      download="processed_audio.mp4"
                      className="w-full py-3 bg-white text-black rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-gray-200 transition-colors"
                    >
                      <Download className="w-5 h-5" />
                      Download MP4
                    </a>
                  </motion.div>
                )}
              </div>
            </section>

            {/* Info Card */}
            <section className="bg-[#151619]/50 border border-[#2a2a2a] rounded-2xl p-6">
              <h3 className="text-xs font-mono uppercase tracking-widest text-gray-500 mb-4">Pipeline Details</h3>
              <ul className="space-y-3">
                <li className="flex items-center gap-3 text-xs text-gray-400">
                  <div className="w-1.5 h-1.5 rounded-full bg-orange-500" />
                  Merge multiple .m4a tracks
                </li>
                <li className="flex items-center gap-3 text-xs text-gray-400">
                  <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                  Convert to 192kbps MP3
                </li>
                <li className="flex items-center gap-3 text-xs text-gray-400">
                  <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
                  Export as H.264 MP4 (720p)
                </li>
              </ul>
            </section>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="max-w-4xl mx-auto px-6 py-12 border-t border-[#1a1b1e] mt-12 flex flex-col md:flex-row justify-between items-center gap-4">
        <div className="flex items-center gap-2 text-gray-500 text-sm">
          <Music className="w-4 h-4" />
          <span>Audio to Video Converter</span>
        </div>
        <div className="flex items-center gap-6">
          <span className="text-[10px] font-mono text-gray-600 uppercase tracking-widest">Powered by FFmpeg.wasm</span>
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${loaded ? 'bg-green-500' : 'bg-yellow-500 animate-pulse'}`} />
            <span className="text-[10px] font-mono text-gray-500 uppercase tracking-widest">
              {loaded ? 'Engine Loaded' : 'Loading Engine...'}
            </span>
          </div>
        </div>
      </footer>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: #0d0e10;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #333;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #444;
        }
      `}</style>
    </div>
  );
}
