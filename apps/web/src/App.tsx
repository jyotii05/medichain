import { lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router';
import { RequireAuth } from '@/lib/auth';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageSkeleton } from '@/components/shared/States';
import LoginPage from '@/pages/LoginPage';
import NotFoundPage from '@/pages/NotFoundPage';

const HomePage = lazy(() => import('@/pages/HomePage'));
const RegisterPage = lazy(() => import('@/pages/RegisterPage'));
const DashboardPage = lazy(() => import('@/pages/DashboardPage'));
const BatchesPage = lazy(() => import('@/pages/batches/BatchesPage'));
const RegisterBatchPage = lazy(() => import('@/pages/batches/RegisterBatchPage'));
const BatchDetailPage = lazy(() => import('@/pages/batches/BatchDetailPage'));
const TrackingPage = lazy(() => import('@/pages/TrackingPage'));
const TransfersPage = lazy(() => import('@/pages/TransfersPage'));
const InventoryPage = lazy(() => import('@/pages/InventoryPage'));
const QrCodesPage = lazy(() => import('@/pages/QrCodesPage'));
const AppVerifyPage = lazy(() => import('@/pages/verify/AppVerifyPage'));
const PublicVerifyPage = lazy(() => import('@/pages/verify/PublicVerifyPage'));
const RecallsPage = lazy(() => import('@/pages/RecallsPage'));
const PartnersPage = lazy(() => import('@/pages/PartnersPage'));
const BlockchainPage = lazy(() => import('@/pages/BlockchainPage'));
const AlertsPage = lazy(() => import('@/pages/AlertsPage'));
const ReportsPage = lazy(() => import('@/pages/ReportsPage'));
const UsersPage = lazy(() => import('@/pages/UsersPage'));
const AuditPage = lazy(() => import('@/pages/AuditPage'));
const SettingsPage = lazy(() => import('@/pages/SettingsPage'));

const page = (el: ReactNode) => <Suspense fallback={<PageSkeleton />}>{el}</Suspense>;

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={page(<HomePage />)} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={page(<RegisterPage />)} />
        {/* Public verification — no account required */}
        <Route path="/verify" element={page(<PublicVerifyPage />)} />
        <Route path="/verify/:code" element={page(<PublicVerifyPage />)} />

        <Route
          path="/app"
          element={
            <RequireAuth>
              <AppLayout />
            </RequireAuth>
          }
        >
          <Route index element={page(<DashboardPage />)} />
          <Route path="batches" element={page(<BatchesPage />)} />
          <Route
            path="batches/new"
            element={
              <RequireAuth roles={['MANUFACTURER']}>{page(<RegisterBatchPage />)}</RequireAuth>
            }
          />
          <Route path="batches/:id" element={page(<BatchDetailPage />)} />
          <Route path="tracking" element={page(<TrackingPage />)} />
          <Route path="tracking/:id" element={page(<TrackingPage />)} />
          <Route path="transfers" element={page(<TransfersPage />)} />
          <Route
            path="inventory"
            element={
              <RequireAuth roles={['MANUFACTURER', 'DISTRIBUTOR', 'WHOLESALER', 'PHARMACY']}>{page(<InventoryPage />)}</RequireAuth>
            }
          />
          <Route
            path="qr"
            element={
              <RequireAuth roles={['MANUFACTURER', 'REGULATOR']}>{page(<QrCodesPage />)}</RequireAuth>
            }
          />
          <Route path="verify" element={page(<AppVerifyPage />)} />
          <Route path="verify/:code" element={page(<AppVerifyPage />)} />
          <Route path="recalls" element={page(<RecallsPage />)} />
          <Route path="partners" element={page(<PartnersPage />)} />
          <Route path="blockchain" element={page(<BlockchainPage />)} />
          <Route path="alerts" element={page(<AlertsPage />)} />
          <Route path="reports" element={page(<ReportsPage />)} />
          <Route
            path="users"
            element={
              <RequireAuth roles={['REGULATOR']}>{page(<UsersPage />)}</RequireAuth>
            }
          />
          <Route
            path="audit"
            element={
              <RequireAuth roles={['REGULATOR']}>{page(<AuditPage />)}</RequireAuth>
            }
          />
          <Route path="settings" element={page(<SettingsPage />)} />
          <Route path="*" element={<NotFoundPage inApp />} />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
  );
}
