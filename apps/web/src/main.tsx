import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './App.tsx';
import { SettingsProvider } from './settings/settings.tsx';
import { TooltipLayer } from './Tooltips.tsx';
import { DialogsProvider } from './Dialogs.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SettingsProvider>
      <DialogsProvider>
        <App />
      </DialogsProvider>
      <TooltipLayer />
    </SettingsProvider>
  </StrictMode>,
);
