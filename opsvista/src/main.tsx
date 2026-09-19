import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import AppErrorBoundary from './AppErrorBoundary';
import AuthGate from './AuthGate';
import { I18nProvider } from './i18n';
import './styles.css';
import './maxDataTheme.css';
import './rampComplianceOverdue.css';
import './corporateImportBootstrap';
import './priceWatchBootstrap';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <I18nProvider><AppErrorBoundary><AuthGate><App /></AuthGate></AppErrorBoundary></I18nProvider>
  </React.StrictMode>,
);
