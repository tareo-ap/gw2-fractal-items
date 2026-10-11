import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import { I18nProvider } from './lib/i18n';
import { SettingsProvider } from './lib/settings';
import './styles.css';

// TanStack Query: one client holds the cache of all server responses (keyed by each query's queryKey).
const queryClient = new QueryClient();

// Entry point: mounts the React tree into <div id="root"> from index.html.
// Providers (React contexts) wrap the app so any component below can read their values via hooks.
// StrictMode renders twice in development to surface side-effect bugs; it has no effect in production.
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
