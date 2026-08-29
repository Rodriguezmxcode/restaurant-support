import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import AppErrorBoundary from './AppErrorBoundary';
import AuthGate from './AuthGate';
import './styles.css';
import './maxDataTheme.css';
import './rampComplianceOverdue.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppErrorBoundary><AuthGate><App /></AuthGate></AppErrorBoundary>
  </React.StrictMode>,
);
