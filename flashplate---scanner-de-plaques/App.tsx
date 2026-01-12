
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Plate, AppMode } from './types';
import { detectPlatesFromImage } from './services/geminiService';
import { 
  PlusIcon, 
  TrashIcon, 
  ListBulletIcon, 
  XMarkIcon,
  ExclamationTriangleIcon,
  VideoCameraIcon,
  HashtagIcon,
  CpuChipIcon,
  SignalIcon,
  MagnifyingGlassPlusIcon,
  BoltIcon
} from '@heroicons/react/24/outline';

const normalizePlate = (val: string) => val.toUpperCase().replace(/[^A-Z0-9]/g, '');
const ALERT_SOUND_URL = 'https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3';

const App: React.FC = () => {
  const [plates, setPlates] = useState<Plate[]>([]);
  const [mode, setMode] = useState<AppMode>(AppMode.LIST);
  const [newPlate, setNewPlate] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [apiStatus, setApiStatus] = useState<'OK' | 'QUOTA' | 'ERROR'>('OK');
  const [detectedRecently, setDetectedRecently] = useState<string | null>(null);
  const [sessionLog, setSessionLog] = useState<{number: string, time: string, match: boolean, type: 'INFO' | 'SUCCESS' | 'ERROR'}[]>([]);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem('flash_plates');
    if (saved) setPlates(JSON.parse(saved));
    audioRef.current = new Audio(ALERT_SOUND_URL);
  }, []);

  useEffect(() => {
    localStorage.setItem('flash_plates', JSON.stringify(plates));
  }, [plates]);

  const addPlate = () => {
    const normalized = normalizePlate(newPlate);
    if (normalized.length < 4) return alert("Format invalide");
    if (plates.some(p => p.number === normalized)) return alert("Déjà surveillé");
    setPlates([{ id: crypto.randomUUID(), number: normalized, createdAt: Date.now() }, ...plates]);
    setNewPlate('');
  };

  const removePlate = (id: string) => setPlates(plates.filter(p => p.id !== id));

  const startCamera = async () => {
    try {
      if (streamRef.current) stopCamera();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { 
          facingMode: 'environment', 
          width: { ideal: 3840, min: 1920 }, 
          height: { ideal: 2160, min: 1080 },
          frameRate: { ideal: 30 }
        }
      });

      const track = stream.getVideoTracks()[0];
      const capabilities = (track as any).getCapabilities?.() || {};
      
      if (capabilities.focusMode?.includes('continuous')) {
        await (track as any).applyConstraints({
          advanced: [{ focusMode: 'continuous' } as any]
        });
      }

      if (capabilities.zoom) {
        await (track as any).applyConstraints({
          advanced: [{ zoom: capabilities.zoom.max / 2 } as any]
        });
      }

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        streamRef.current = stream;
      }
    } catch (err) {
      alert("Erreur Caméra HD/4K. Vérifiez les permissions.");
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
  };

  const addLog = (msg: string, type: 'INFO' | 'SUCCESS' | 'ERROR' = 'INFO', match = false) => {
    setSessionLog(prev => [{
      number: msg,
      time: new Date().toLocaleTimeString('fr-FR', { hour12: false }),
      match,
      type
    }, ...prev].slice(0, 15));
  };

  const processFrame = useCallback(async () => {
    // Si déjà en train de traiter, on saute ce cycle pour ne pas empiler les requêtes
    if (!videoRef.current || !canvasRef.current || isProcessing || mode !== AppMode.FLASH) return;
    if (videoRef.current.readyState !== videoRef.current.HAVE_ENOUGH_DATA) return;

    setIsProcessing(true);
    const context = canvasRef.current.getContext('2d');
    if (!context) {
      setIsProcessing(false);
      return;
    }

    const vW = videoRef.current.videoWidth;
    const vH = videoRef.current.videoHeight;

    const cropWidth = vW * 0.6;
    const cropHeight = vH * 0.4;
    const startX = (vW - cropWidth) / 2;
    const startY = (vH - cropHeight) / 2;

    canvasRef.current.width = 1280;
    canvasRef.current.height = 720;
    
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'medium'; // Passer en medium peut accélérer le rendu canvas légèrement
    
    context.drawImage(
      videoRef.current, 
      startX, startY, cropWidth, cropHeight,
      0, 0, 1280, 720
    );

    // Légère baisse de qualité (0.8 vs 0.9) pour réduire la taille du payload et accélérer l'upload réseau
    const base64 = canvasRef.current.toDataURL('image/jpeg', 0.8).split(',')[1];

    try {
      // Notification visuelle plus discrète pour le scan rapide
      const detected = await detectPlatesFromImage(base64);
      setApiStatus('OK');

      detected.forEach(num => {
        const norm = normalizePlate(num);
        const isMatch = plates.some(p => p.number === norm);
        addLog(norm, isMatch ? 'SUCCESS' : 'INFO', isMatch);
        if (isMatch) {
          audioRef.current?.play().catch(() => {});
          setDetectedRecently(norm);
          setTimeout(() => setDetectedRecently(null), 5000);
        }
      });
    } catch (e: any) {
      setApiStatus(e.message === "QUOTA_EXCEEDED" ? 'QUOTA' : 'ERROR');
      if (e.message !== "QUOTA_EXCEEDED") addLog("SIGNAL LOSS", "ERROR");
    } finally {
      setIsProcessing(false);
    }
  }, [plates, isProcessing, mode]);

  useEffect(() => {
    let interval: number;
    if (mode === AppMode.FLASH) {
      startCamera();
      // Fréquence augmentée : Un scan toutes les 1.2 secondes pour plus de réactivité sur la route
      interval = window.setInterval(processFrame, 1200);
    } else {
      stopCamera();
    }
    return () => {
      clearInterval(interval);
      stopCamera();
    };
  }, [mode, processFrame]);

  return (
    <div className="flex flex-col h-screen bg-black text-blue-400 overflow-hidden font-mono select-none">
      <header className="px-4 py-2 bg-slate-900 border-b border-blue-900/50 flex justify-between items-center z-50">
        <div className="flex items-center gap-3">
          <div className={`w-2 h-2 rounded-full ${apiStatus === 'OK' ? 'bg-green-500 shadow-[0_0_8px_green]' : 'bg-red-500 animate-pulse'}`} />
          <h1 className="text-xs font-black tracking-widest uppercase">LAPI-TURBO // ULTRA_FAST</h1>
        </div>
        <div className="flex gap-4 text-[10px] items-center">
          <div className={`flex items-center gap-1 ${isProcessing ? 'text-yellow-400' : 'text-green-400'}`}>
            <BoltIcon className={`w-3 h-3 ${isProcessing ? 'animate-pulse' : ''}`} />
            <span>{isProcessing ? 'SCANNING' : 'READY'}</span>
          </div>
          <div className="flex items-center gap-1">
            <SignalIcon className={`w-3 h-3 ${apiStatus === 'OK' ? 'text-green-400' : 'text-red-500'}`} />
            <span>{apiStatus}</span>
          </div>
        </div>
      </header>

      <main className="flex-1 relative">
        {mode === AppMode.LIST ? (
          <div className="h-full overflow-y-auto p-4 bg-slate-950">
            <div className="mb-6 bg-slate-900 p-4 border border-blue-900/40 rounded-lg shadow-inner">
              <label className="text-[10px] uppercase font-bold text-blue-600 block mb-2 tracking-tighter">Target Watchlist</label>
              <div className="flex gap-2">
                <input 
                  type="text"
                  value={newPlate}
                  onChange={(e) => setNewPlate(e.target.value)}
                  placeholder="NUMÉRO"
                  className="flex-1 bg-black border border-blue-900/50 rounded px-3 py-2 text-white font-mono uppercase focus:ring-1 focus:ring-blue-500 outline-none"
                />
                <button onClick={addPlate} className="bg-blue-700 text-white px-6 rounded font-black active:scale-95 transition shadow-[0_0_15px_rgba(29,78,216,0.4)]">
                  VALIDEZ
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-700 px-1">Watchlist Database</h2>
              {plates.length === 0 ? (
                <div className="py-12 text-center text-slate-700 text-xs italic border border-dashed border-slate-900 rounded">BASE VIDE</div>
              ) : (
                plates.map(p => (
                  <div key={p.id} className="bg-slate-900 border border-blue-900/20 p-4 flex justify-between items-center rounded">
                    <div>
                      <span className="text-2xl font-black text-white tracking-[0.15em]">{p.number}</span>
                      <div className="text-[8px] opacity-40 uppercase mt-1">SIV_WATCH // {new Date(p.createdAt).toLocaleDateString()}</div>
                    </div>
                    <button onClick={() => removePlate(p.id)} className="text-slate-600 hover:text-red-500 transition-all p-2">
                      <TrashIcon className="w-5 h-5" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        ) : (
          <div className="absolute inset-0 flex flex-col bg-black overflow-hidden">
            <video 
              ref={videoRef} 
              autoPlay 
              playsInline 
              muted 
              className="absolute inset-0 w-full h-full object-cover opacity-90 grayscale-[0.2]" 
            />
            
            <div className="absolute inset-0 flex flex-col pointer-events-none">
              <div className="flex-1 relative m-2 border border-blue-500/10 rounded-xl overflow-hidden shadow-[inset_0_0_100px_rgba(0,0,0,0.8)]">
                <div className={`scanning-line ${isProcessing ? 'opacity-100' : 'opacity-20'}`} style={{ animationDuration: '0.8s' }} />
                
                <div className="absolute top-4 right-4 flex flex-col items-end gap-1">
                   <div className="bg-black/80 px-3 py-1 rounded border border-yellow-500/30 flex items-center gap-2">
                      <BoltIcon className="w-4 h-4 text-yellow-500 animate-pulse" />
                      <span className="text-[10px] font-bold text-yellow-400">MODE: TURBO_SCAN</span>
                   </div>
                   <span className="text-[8px] text-blue-600 bg-black/40 px-2 rounded tracking-widest uppercase">Burst-Capture Enabled</span>
                </div>

                <div className="absolute top-0 left-0 w-24 h-24 border-t-4 border-l-4 border-blue-500" />
                <div className="absolute top-0 right-0 w-24 h-24 border-t-4 border-r-4 border-blue-500" />
                <div className="absolute bottom-0 left-0 w-24 h-24 border-b-4 border-l-4 border-blue-500" />
                <div className="absolute bottom-0 right-0 w-24 h-24 border-b-4 border-r-4 border-blue-500" />

                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[70%] h-[40%] border-2 border-white/5 flex flex-col items-center justify-center">
                   <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-full mb-2">
                      <span className="text-[9px] text-blue-500 font-black tracking-widest uppercase bg-black/40 px-3">High-Speed Lock Zone</span>
                   </div>
                   <div className="w-16 h-16 border border-blue-500/20 rounded-full flex items-center justify-center">
                     <div className={`w-2 h-2 rounded-full shadow-[0_0_10px_red] ${isProcessing ? 'bg-red-500 animate-ping' : 'bg-red-900'}`} />
                   </div>
                </div>
              </div>

              <div className="h-[35%] bg-slate-950/98 backdrop-blur-2xl border-t border-blue-900/50 p-4 overflow-hidden">
                <div className="flex justify-between items-center mb-2 border-b border-blue-900/30 pb-2">
                  <span className="text-[10px] font-black text-blue-400 tracking-[0.2em] uppercase">Live Neural Processor Feed</span>
                  <span className="text-[8px] bg-red-950 text-red-500 px-2 py-0.5 rounded border border-red-500/30 animate-pulse">TURBO_LAPI</span>
                </div>
                
                <div className="space-y-1 overflow-y-auto h-full pb-10">
                  {sessionLog.length === 0 && <p className="text-slate-800 italic animate-pulse text-[10px]">POLLING DATA STREAM...</p>}
                  {sessionLog.map((log, i) => (
                    <div key={i} className={`flex justify-between items-center py-1 border-b border-white/5 transition-colors ${log.match ? 'bg-red-900/60 text-red-100 font-black px-2 border-l-4 border-red-400 shadow-[0_0_15px_rgba(220,38,38,0.4)]' : 'opacity-60 text-blue-300'}`}>
                      <span className="text-[9px] font-mono opacity-50">[{log.time}]</span>
                      <span className="tracking-[0.3em] font-bold text-sm font-mono">{log.number}</span>
                      <span className="text-[8px] font-black uppercase tracking-tighter">{log.match ? '!! MATCH !!' : 'LOGGED'}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {apiStatus === 'QUOTA' && (
              <div className="absolute top-4 inset-x-4 z-[110]">
                <div className="bg-orange-600 text-white p-2 rounded text-[10px] font-bold text-center border-2 border-white/20 shadow-2xl animate-pulse">
                  API QUOTA LIMIT: LE SCAN PEUT RALENTIR
                </div>
              </div>
            )}

            {detectedRecently && (
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[100] w-full max-w-sm px-8 pointer-events-none">
                <div className="bg-red-900/95 backdrop-blur border-4 border-white text-white p-6 rounded shadow-[0_0_250px_rgba(255,0,0,1)] glitch">
                  <div className="flex items-center gap-4 mb-4 border-b-2 border-white/40 pb-3">
                    <ExclamationTriangleIcon className="w-14 h-14" />
                    <div>
                      <h2 className="font-black text-3xl italic leading-none uppercase tracking-tighter">ALERTE CIBLE</h2>
                      <p className="text-[10px] font-black opacity-80 mt-1 tracking-[0.2em]">IDENTIFICATION TURBO RÉUSSIE</p>
                    </div>
                  </div>
                  <div className="bg-black/90 py-6 rounded-sm border border-white/20 text-center shadow-[inset_0_0_30px_black]">
                    <span className="text-6xl font-black tracking-tighter font-mono">{detectedRecently}</span>
                  </div>
                </div>
              </div>
            )}
            
            <canvas ref={canvasRef} className="hidden" />
          </div>
        )}
      </main>

      <nav className="bg-slate-900 border-t border-blue-900/50 p-4 pb-8 flex justify-around items-center z-50">
        <button onClick={() => setMode(AppMode.LIST)} className={`flex flex-col items-center gap-1 transition-all ${mode === AppMode.LIST ? 'text-blue-400 scale-110' : 'text-slate-600 hover:text-blue-400'}`}>
          <ListBulletIcon className="w-7 h-7" />
          <span className="text-[9px] font-black uppercase tracking-tighter">Database</span>
        </button>

        <button 
          onClick={() => setMode(mode === AppMode.FLASH ? AppMode.LIST : AppMode.FLASH)} 
          className="relative"
        >
          <div className={`p-5 -mt-16 rounded-full border-4 border-black transition-all duration-300 shadow-2xl ${mode === AppMode.FLASH ? 'bg-red-600 rotate-90 scale-110' : 'bg-blue-600 shadow-[0_0_50px_rgba(37,99,235,0.7)]'}`}>
            {mode === AppMode.FLASH ? <XMarkIcon className="w-10 h-10 text-white" /> : <VideoCameraIcon className="w-10 h-10 text-white" />}
          </div>
          <span className={`absolute -bottom-6 left-1/2 -translate-x-1/2 text-[9px] font-black uppercase tracking-widest text-center min-w-[150px] ${mode === AppMode.FLASH ? 'text-red-500' : 'text-blue-500'}`}>
            {mode === AppMode.FLASH ? 'STOP_FAST_SCAN' : 'BOOT_TURBO_LAPI'}
          </span>
        </button>

        <div className="w-12 h-12 flex items-center justify-center">
          <div className={`w-3 h-3 rounded-full transition-all ${isProcessing ? 'bg-yellow-400 animate-ping shadow-[0_0_20px_#eab308]' : 'bg-slate-800'}`} />
        </div>
      </nav>
    </div>
  );
};

export default App;
