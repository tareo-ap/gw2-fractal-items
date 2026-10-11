import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import { I18nProvider } from './lib/i18n';
import { SettingsProvider } from './lib/settings';
import './styles.css';

const queryClient = new QueryClient();

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <QueryClientProvider client={queryClient}>
            <SettingsProvider>
                <I18nProvider>
                    <App />
                </I18nProvider>
            </SettingsProvider>
        </QueryClientProvider>
    </StrictMode>,
);
