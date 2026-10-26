import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import RegisterPage from './RegisterPage';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let fetchMock: ReturnType<typeof vi.fn>;
const registerCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/api/auth/register'));

beforeEach(() => {
  fetchMock = vi.fn(async (url: string) => {
    if (url.endsWith('/api/auth/me')) return json(401, { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/register']}>
        <Routes>
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/app" element={<p>Dashboard</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function fillValid(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/^Full name/), 'Nadia Okafor');
  await user.type(screen.getByLabelText(/^Work email/), 'nadia@lakeside.example');
  await user.type(screen.getByLabelText(/^Password\*?$/), 'Lakeside2026pw');
  await user.type(screen.getByLabelText(/^Confirm password/), 'Lakeside2026pw');
  await user.type(screen.getByLabelText(/^Organization name/), 'Lakeside Pharma');
  await user.click(screen.getByRole('radio', { name: /Manufacturer/ }));
  await user.type(screen.getByLabelText(/^Licence number/), 'MFG-LKS-1042');
  await user.click(screen.getByRole('checkbox', { name: /terms of use/ }));
}

// Filling the whole form with userEvent takes a few seconds under load; the 5 s default makes these tests flaky.
describe('RegisterPage', { timeout: 20_000 }, () => {
  it('renders the heading, a sign-in link and no regulator option', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Create Your MediChain Account' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
    expect(screen.getAllByRole('radio').map((r) => (r as HTMLInputElement).value)).toEqual(['MANUFACTURER', 'DISTRIBUTOR', 'WHOLESALER', 'PHARMACY']);
  });

  it('blocks submission with an invalid email, mismatched passwords and unaccepted terms', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('heading', { name: 'Create Your MediChain Account' });
    await user.type(screen.getByLabelText(/^Work email/), 'not-an-email');
    await user.type(screen.getByLabelText(/^Password\*?$/), 'Lakeside2026pw');
    await user.type(screen.getByLabelText(/^Confirm password/), 'Different2026pw');
    await user.click(screen.getByRole('button', { name: /Create account/ }));

    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument();
    expect(screen.getByText('Passwords do not match')).toBeInTheDocument();
    expect(screen.getByText('You must accept the terms to create an account')).toBeInTheDocument();
    expect(screen.getByText('Choose your organization’s supply-chain role')).toBeInTheDocument();
    expect(registerCalls()).toHaveLength(0);
  });

  it('toggles password visibility', async () => {
    const user = userEvent.setup();
    renderPage();
    const pw = await screen.findByLabelText(/^Password\*?$/);
    expect(pw).toHaveAttribute('type', 'password');
    await user.click(screen.getByRole('button', { name: 'Show passwords' }));
    expect(pw).toHaveAttribute('type', 'text');
    expect(screen.getByLabelText(/^Confirm password/)).toHaveAttribute('type', 'text');
  });

  it('shows a server duplicate-email error on the email field', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/api/auth/me')) return json(401, { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      return json(409, {
        error: {
          code: 'DUPLICATE_EMAIL',
          message: 'An account with this email already exists. Sign in instead.',
          details: [{ path: 'email', message: 'An account with this email already exists' }],
        },
      });
    });
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('heading', { name: 'Create Your MediChain Account' });
    await fillValid(user);
    await user.click(screen.getByRole('button', { name: /Create account/ }));

    expect(await screen.findByText('An account with this email already exists. Sign in instead.', {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByText('An account with this email already exists')).toBeInTheDocument();
    expect(screen.getByLabelText(/^Work email/)).toHaveAttribute('aria-invalid', 'true');
  });

  it('submits a valid form once, shows the pending-approval confirmation and continues to the app', async () => {
    let resolveRegister: (r: Response) => void = () => {};
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/api/auth/me')) return Promise.resolve(json(401, { error: { code: 'UNAUTHORIZED', message: 'x' } }));
      return new Promise<Response>((r) => (resolveRegister = r));
    });
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('heading', { name: 'Create Your MediChain Account' });
    await fillValid(user);
    await user.click(screen.getByRole('button', { name: /Create account/ }));

    // loading state disables the button, so a second click cannot submit twice
    const busy = await screen.findByRole('button', { name: /Creating account/ }, { timeout: 4000 });
    expect(busy).toBeDisabled();
    await user.click(busy);
    expect(registerCalls()).toHaveLength(1);

    const sent = JSON.parse(registerCalls()[0][1].body);
    expect(sent).toMatchObject({
      email: 'nadia@lakeside.example',
      acceptTerms: true,
      organization: { type: 'MANUFACTURER', licenseNumber: 'MFG-LKS-1042' },
    });
    expect(sent).not.toHaveProperty('role');

    resolveRegister(
      json(201, {
        user: {
          id: 'u1',
          email: 'nadia@lakeside.example',
          fullName: 'Nadia Okafor',
          role: 'MANUFACTURER',
          title: null,
          lastLoginAt: null,
          isDemo: false,
          organization: { id: 'o1', name: 'Lakeside Pharma', type: 'MANUFACTURER', status: 'PENDING', licenseNumber: 'MFG-LKS-1042', city: null, country: null },
        },
        csrfToken: 'a'.repeat(48),
      }),
    );
    expect(await screen.findByRole('heading', { name: 'Account created' }, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByText('Pending regulator approval')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Continue to dashboard/ }));
    await waitFor(() => expect(screen.getByText('Dashboard')).toBeInTheDocument());
  });
});
