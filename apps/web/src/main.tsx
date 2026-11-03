import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './App.tsx';
import { SettingsProvider } from './settings/settings.tsx';
import { TooltipLayer } from './Tooltips.tsx';
import { DialogsProvider } from './Dialogs.tsx';
import { ErrorBoundary } from './ErrorBoundary.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SettingsProvider>
      {/* いちばん外側の、最後の受け皿（ここまで来たら、画面全体を作り直すしかない） */}
      <ErrorBoundary scope="app">
        <DialogsProvider>
          <App />
        </DialogsProvider>
      </ErrorBoundary>
      <TooltipLayer />
    </SettingsProvider>
  </StrictMode>,
);
