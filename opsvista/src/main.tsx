import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import AppErrorBoundary from './AppErrorBoundary';
import AuthGate from './AuthGate';
import { I18nProvider } from './i18n';
import MarketingSite from './MarketingSite';
import './styles.css';
import './maxDataTheme.css';
import './rampComplianceOverdue.css';
import './corporateImportBootstrap';
import './priceWatchBootstrap';

const isMarketingHost=typeof window!=='undefined'&&(['getopsvista.com','www.getopsvista.com'].includes(window.location.hostname.toLowerCase())||new URLSearchParams(window.location.search).get('marketing')==='1');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <I18nProvider><AppErrorBoundary>{isMarketingHost?<MarketingSite/>:<AuthGate><App /></AuthGate>}</AppErrorBoundary></I18nProvider>
  </React.StrictMode>,
);
