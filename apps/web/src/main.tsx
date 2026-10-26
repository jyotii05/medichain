import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import '@fontsource-variable/inter';
import '@fontsource-variable/manrope';
import './index.css';
import { App } from './App';
import { TooltipProvider } from '@/components/ui/misc';
import { ApiError } from '@/lib/api';
import { ME_KEY } from '@/lib/auth';

const queryClient: QueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 20_000,
      refetchOnWindowFocus: false,
      retry: (count, e) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) && count < 2,
    },
  },
  queryCache: new QueryCache({
    // If the session expires mid-use, drop the cached user so the route guard sends us to /login.
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) queryClient.setQueryData(ME_KEY, null);
    },
  }),
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <App />
        <Toaster
          position="top-right"
          closeButton
          toastOptions={{
            classNames: {
              toast: '!rounded-xl !border-line !bg-surface !text-ink !shadow-[var(--shadow-raised)] !font-sans',
              description: '!text-muted',
            },
          }}
        />
      </TooltipProvider>
    </QueryClientProvider>
  </StrictMode>,
);
