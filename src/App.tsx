import React, { useEffect, useState, useRef } from 'react';
import axios from 'axios';
import { formatInTimeZone } from 'date-fns-tz';
import { Activity, CheckCircle2, XCircle, Clock, RefreshCw, BellRing, FileText, Award, FileCheck, Bell, Send, Volume2 } from 'lucide-react';

interface Status {
  admitCardReleased: boolean;
  responseSheetReleased: boolean;
  resultReleased: boolean;
  lastChecked: string;
}

interface Log {
  id: number;
  timestamp: string;
  type: string;
  message: string;
  details: string;
}

export default function App() {
  const [status, setStatus] = useState<Status | null>(null);
  const [logs, setLogs] = useState<Log[]>([]);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [testingPush, setTestingPush] = useState(false);
  const [testDelay, setTestDelay] = useState(0);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [showTruth, setShowTruth] = useState(false);
  const [audioDelay, setAudioDelay] = useState(0);
  const [schedulingAudio, setSchedulingAudio] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const prevStatusRef = useRef<Status | null>(null);

  useEffect(() => {
    if ('serviceWorker' in navigator && 'PushManager' in window) {
      navigator.serviceWorker.register('/sw.js').then(reg => {
        reg.pushManager.getSubscription().then(sub => {
          if (sub) setPushEnabled(true);
        });
      });
    }
  }, []);

  const subscribeToPush = async () => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      alert('Push notifications are not supported by your browser.');
      return;
    }

    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        alert('Permission for notifications was denied');
        return;
      }

      const reg = await navigator.serviceWorker.ready;
      
      // Get public key from server
      const response = await axios.get('/api/vapidPublicKey');
      const vapidPublicKey = response.data;
      
      const convertedVapidKey = urlBase64ToUint8Array(vapidPublicKey);

      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: convertedVapidKey
      });

      await axios.post('/api/subscribe', subscription);
      setPushEnabled(true);
      alert('Successfully subscribed to push notifications!');
    } catch (error) {
      console.error('Failed to subscribe to push notifications:', error);
      alert('Failed to subscribe to push notifications.');
    }
  };

  // Utility function
  function urlBase64ToUint8Array(base64String: string) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
      .replace(/\-/g, '+')
      .replace(/_/g, '/');

    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }

  const fetchData = async () => {
    try {
      const [statusRes, logsRes] = await Promise.all([
        axios.get('/api/status'),
        axios.get('/api/logs')
      ]);
      setStatus(statusRes.data);
      setLogs(Array.isArray(logsRes.data) ? logsRes.data : []);
    } catch (error) {
      console.error('Failed to fetch data:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10000); // Poll every 10s
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (prevStatusRef.current && status) {
      // Play audio if resultReleased changes from false to true
      if (!prevStatusRef.current.resultReleased && status.resultReleased) {
        playAudioAlert();
      }
    }
    prevStatusRef.current = status;
  }, [status]);

  const playAudioAlert = () => {
    if (audioDelay > 0) {
      setSchedulingAudio(true);
      setTimeout(() => {
        setSchedulingAudio(false);
        triggerAudio();
      }, audioDelay * 1000);
    } else {
      triggerAudio();
    }
  };

  const triggerAudio = () => {
    if (audioRef.current) {
      audioRef.current.volume = 1.0; // Maximize volume
      audioRef.current.currentTime = 0;
      audioRef.current.play().then(() => {
        setIsPlayingAudio(true);
      }).catch(err => {
        console.error('Failed to play audio:', err);
        // Browser might block autoplay if no user interaction has occurred
      });
    }
  };

  const stopAudioAlert = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setIsPlayingAudio(false);
    }
  };

  const handleManualCheck = async () => {
    setChecking(true);
    try {
      await axios.post('/api/check');
      await fetchData();
    } catch (error) {
      console.error('Failed to trigger manual check:', error);
    } finally {
      setChecking(false);
    }
  };

  const handleTestNotification = async () => {
    setTestingPush(true);
    try {
      let sub = null;
      if ('serviceWorker' in navigator && 'PushManager' in window) {
        const reg = await navigator.serviceWorker.ready;
        sub = await reg.pushManager.getSubscription();
      }

      await axios.post('/api/test-notification', { delay: testDelay, subscription: sub });
      if (testDelay > 0) {
        alert(`Test notification scheduled! It will arrive in ${testDelay} seconds. You can minimize your browser now to see how it looks on your desktop.`);
      } else {
        alert('Test notification sent! It should arrive shortly.');
      }
    } catch (error: any) {
      console.error('Failed to send test notification:', error);
      if (error.response?.data?.error === 'SUBSCRIPTION_INVALID') {
        alert('Your push subscription expired because the server keys changed. We are resetting it now. Please click "Enable Alerts" again.');
        if ('serviceWorker' in navigator && 'PushManager' in window) {
          const reg = await navigator.serviceWorker.ready;
          const existingSub = await reg.pushManager.getSubscription();
          if (existingSub) await existingSub.unsubscribe();
        }
        setPushEnabled(false);
      } else {
        alert('Failed to send test notification. Check console for details.');
      }
    } finally {
      setTestingPush(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans pb-12">
      {isPlayingAudio && (
        <div className="bg-red-600 text-white px-4 py-3 shadow-md flex items-center justify-center gap-4 sticky top-0 z-50">
          <div className="flex items-center gap-2 font-bold animate-pulse">
            <BellRing className="h-5 w-5" />
            <span>ALARM PLAYING!</span>
          </div>
          <button
            onClick={stopAudioAlert}
            className="px-4 py-1.5 bg-white text-red-600 text-sm font-bold rounded-md hover:bg-red-50 transition-colors shadow-sm"
          >
            Stop Alarm
          </button>
        </div>
      )}
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Activity className="h-6 w-6 text-blue-600" />
            <h1 className="text-xl font-bold tracking-tight">JEE Main Tracker</h1>
            <a 
              href="https://jeemain.nta.nic.in/" 
              target="_blank" 
              rel="noopener noreferrer"
              className="ml-4 text-sm font-medium text-blue-600 hover:text-blue-800 hidden sm:inline-block bg-blue-50 px-3 py-1 rounded-full"
            >
              Visit NTA Website &rarr;
            </a>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-4">
            <div className="flex items-center gap-2 text-sm text-slate-500 hidden sm:flex">
              <Clock className="h-4 w-4" />
              <span>Last checked: {status?.lastChecked ? formatInTimeZone(new Date(status.lastChecked), 'Asia/Kolkata', 'MMM d, h:mm:ss a') + ' IST' : 'Never'}</span>
            </div>
            

            <div className="flex items-center bg-purple-50 rounded-md border border-purple-200 p-1">
              <select
                value={audioDelay}
                onChange={(e) => setAudioDelay(Number(e.target.value))}
                className="bg-transparent text-sm text-purple-800 font-medium focus:outline-none cursor-pointer px-2"
                title="Audio Delay"
              >
                <option value={0}>Now</option>
                <option value={5}>In 5s</option>
                <option value={15}>In 15s</option>
                <option value={30}>In 30s</option>
              </select>
              <div className="w-px h-4 bg-purple-200 mx-1"></div>
              <button
                onClick={playAudioAlert}
                disabled={schedulingAudio}
                title="Test Audio Alert"
                className="inline-flex items-center justify-center p-1.5 text-purple-700 hover:bg-purple-200 rounded focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-50 transition-colors"
              >
                {schedulingAudio ? (
                  <Clock className="h-4 w-4 animate-pulse" />
                ) : (
                  <Volume2 className="h-4 w-4" />
                )}
              </button>
            </div>

            <button
              onClick={handleManualCheck}
              disabled={checking}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 transition-colors"
            >
              <RefreshCw className={`h-4 w-4 ${checking ? 'animate-spin' : ''}`} />
              {checking ? 'Checking...' : 'Check Now'}
            </button>
            {pushEnabled ? (
              <div className="flex items-center gap-2">
                <button
                  onClick={async () => {
                    if (window.confirm('Do you want to reset your notification subscription? Use this if notifications stopped working.')) {
                      const reg = await navigator.serviceWorker.ready;
                      const sub = await reg.pushManager.getSubscription();
                      if (sub) await sub.unsubscribe();
                      setPushEnabled(false);
                    }
                  }}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md bg-green-100 text-green-700 hover:bg-green-200 transition-colors cursor-pointer"
                  title="Click to reset subscription"
                >
                  <Bell className="h-4 w-4" />
                  Notifications On
                </button>
                <div className="flex items-center bg-blue-50 rounded-md border border-blue-200 p-1">
                  <select
                    value={testDelay}
                    onChange={(e) => setTestDelay(Number(e.target.value))}
                    className="bg-transparent text-sm text-blue-800 font-medium focus:outline-none cursor-pointer px-2"
                    title="Notification Delay"
                  >
                    <option value={0}>Now</option>
                    <option value={5}>In 5s</option>
                    <option value={15}>In 15s</option>
                    <option value={30}>In 30s</option>
                  </select>
                  <div className="w-px h-4 bg-blue-200 mx-1"></div>
                  <button
                    onClick={handleTestNotification}
                    disabled={testingPush}
                    title="Send Test Notification"
                    className="inline-flex items-center justify-center p-1.5 text-blue-700 hover:bg-blue-200 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 transition-colors"
                  >
                    <Send className={`h-4 w-4 ${testingPush ? 'opacity-50' : ''}`} />
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={subscribeToPush}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 transition-colors bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 focus:ring-slate-500"
              >
                <Bell className="h-4 w-4" />
                Enable Alerts
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {/* Status Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <StatusCard
            title="Admit Card"
            icon={<FileText className="h-5 w-5" />}
            isReleased={status?.admitCardReleased}
            description="Hall ticket for examination"
          />
          <StatusCard
            title="Response Sheet"
            icon={<FileCheck className="h-5 w-5" />}
            isReleased={status?.responseSheetReleased}
            description="Provisional answer key & responses"
          />
          <StatusCard
            title="Result"
            icon={<Award className="h-5 w-5" />}
            isReleased={status?.resultReleased}
            description="Final scores and percentiles"
          />
        </div>

        {/* Logs Section */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="px-6 py-5 border-b border-slate-200 flex items-center justify-between bg-slate-50/50">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <BellRing className="h-5 w-5 text-slate-500" />
              Activity Logs
            </h2>
            <span className="text-xs font-medium px-2.5 py-1 bg-slate-100 text-slate-600 rounded-full">
              Last 50 events
            </span>
          </div>
          <div className="divide-y divide-slate-100 max-h-[600px] overflow-y-auto">
            {logs.length === 0 ? (
              <div className="p-8 text-center text-slate-500">
                No logs available yet.
              </div>
            ) : (
              logs.map((log) => (
                <div key={log.id} className="p-4 sm:px-6 hover:bg-slate-50 transition-colors flex gap-4">
                  <div className="flex-shrink-0 mt-1">
                    {log.type === 'UPDATE' ? (
                      <div className="h-8 w-8 rounded-full bg-green-100 flex items-center justify-center">
                        <CheckCircle2 className="h-4 w-4 text-green-600" />
                      </div>
                    ) : log.type === 'ERROR' ? (
                      <div className="h-8 w-8 rounded-full bg-red-100 flex items-center justify-center">
                        <XCircle className="h-4 w-4 text-red-600" />
                      </div>
                    ) : (
                      <div className="h-8 w-8 rounded-full bg-blue-100 flex items-center justify-center">
                        <Activity className="h-4 w-4 text-blue-600" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-slate-900 truncate">
                        {log.message}
                      </p>
                      <time className="text-xs text-slate-500 whitespace-nowrap">
                        {formatInTimeZone(new Date(log.timestamp), 'Asia/Kolkata', 'MMM d, h:mm:ss a')} IST
                      </time>
                    </div>
                    {log.details && (
                      <p className="mt-1 text-sm text-slate-500 whitespace-pre-wrap">
                        {log.details}
                      </p>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
        <audio ref={audioRef} src="https://actions.google.com/sounds/v1/alarms/alarm_clock.ogg" preload="auto" loop />
      </main>

      {/* Breaking News Marquee */}
      {showTruth && (
        <div className="fixed bottom-0 left-0 w-full bg-red-600 text-white font-bold py-2 overflow-hidden z-50 border-t-4 border-red-800">
          <div className="whitespace-nowrap inline-block animate-marquee-ltr text-lg tracking-widest">
            🚨 BREAKING NEWS ANTASH SHARMA HAS CHHOTA LUN 🚨
          </div>
        </div>
      )}

      {/* Secret toggle button */}
      <button
        onClick={() => setShowTruth(!showTruth)}
        className="fixed bottom-3 right-4 text-xs text-slate-400 hover:text-slate-600 transition-colors z-[60] cursor-pointer font-mono select-none"
      >
        v1.0.4
      </button>
    </div>
  );
}

function StatusCard({ title, icon, isReleased, description }: { title: string, icon: React.ReactNode, isReleased?: boolean, description: string }) {
  return (
    <div className={`relative overflow-hidden rounded-xl border p-6 transition-all ${isReleased ? 'bg-green-50/50 border-green-200' : 'bg-white border-slate-200'}`}>
      <div className="flex items-center justify-between mb-4">
        <div className={`p-2 rounded-lg ${isReleased ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'}`}>
          {icon}
        </div>
        {isReleased ? (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Released
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-600">
            <Clock className="h-3.5 w-3.5" />
            Pending
          </span>
        )}
      </div>
      <div>
        <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
        <p className="text-sm text-slate-500 mt-1">{description}</p>
      </div>
      {isReleased && (
        <div className="mt-4 pt-4 border-t border-green-200/50">
          <a
            href="https://jeemain.nta.nic.in/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-green-700 hover:text-green-800 flex items-center gap-1"
          >
            Go to official website &rarr;
          </a>
        </div>
      )}
    </div>
  );
}
