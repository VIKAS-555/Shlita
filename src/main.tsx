import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App.js';
import { LiveControlPlane } from './live/LiveControlPlane.js';
import './index.css';
import { Analytics } from '@vercel/analytics/react';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {new URLSearchParams(window.location.search).get('demo') === '1' ? <App /> : <LiveControlPlane />}
    <Analytics />
  </React.StrictMode>
);
