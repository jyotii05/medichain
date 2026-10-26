import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { VerificationResponse } from '@/lib/types';
import { VerificationResult } from './VerificationResult';

// RTL auto-cleanup only registers when vitest globals are enabled.
afterEach(cleanup);

vi.mock('@/components/batch/SupplyChainTimeline', () => ({
  SupplyChainTimeline: ({ stages }: { stages: unknown[] }) => <div data-testid="timeline">{stages.length} stages</div>,
}));
vi.mock('@/components/recalls/RecallAlert', () => ({
  RecallAlert: ({ recall }: { recall: { reference: string; reason: string } }) => (
    <div data-testid="recall-alert">
      {recall.reference}: {recall.reason}
    </div>
  ),
}));

const DISCLAIMER = 'This result confirms that the code matches a registered batch record. It does not by itself prove that the physical pack is genuine.';

const batch: NonNullable<VerificationResponse['batch']> = {
  publicId: 'MC-HPW0-TK2Y-EXAF',
  batchNumber: 'OMP-2026-1001',
  medicine: { name: 'Omezol', genericName: 'Omeprazole', strength: '20 mg', dosageForm: 'Capsule', category: 'Gastrointestinal' },
  manufacturer: { name: 'Aurelia Pharmaceuticals Ltd.', country: 'Meridia' },
  manufactureDate: '2026-10-04',
  expiryDate: '2028-10-03',
  storageConditions: 'Store below 25 °C',
  status: 'ACTIVE',
  displayStatus: 'ACTIVE',
  currentCustodian: { name: 'Aurelia Pharmaceuticals Ltd.', type: 'MANUFACTURER', city: 'Westhaven' },
};

function make(overrides: Partial<VerificationResponse>): VerificationResponse {
  return {
    result: 'VERIFIED',
    headline: 'Verified record — registered and consistent custody history',
    reasons: [],
    queriedId: 'MC-HPW0-TK2Y-EXAF',
    verifiedAt: '2026-10-09T11:40:18.485Z',
    disclaimer: DISCLAIMER,
    checks: [{ key: 'integrity', label: 'Record integrity', status: 'pass', detail: 'All events match' }],
    batch,
    recall: null,
    journey: [],
    events: [],
    chain: null,
    ...overrides,
  };
}

describe('VerificationResult', () => {
  it('never renders an UNKNOWN identifier as verified', () => {
    const { container } = render(
      <VerificationResult
        data={make({ result: 'UNKNOWN', headline: 'Unknown identifier — not found in the registry', batch: null, checks: undefined, reasons: ['This is not a valid MediChain identifier format'], queriedId: 'MC-FAKE' })}
      />,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Unknown identifier' })).toBeInTheDocument();
    expect(screen.queryByText(/verified record/i)).not.toBeInTheDocument();
    expect(container.querySelector('[data-result="UNKNOWN"]')?.className).not.toMatch(/success/);
    expect(container.innerHTML).not.toMatch(/bg-success/);
  });

  it('shows "Verified record" for a VERIFIED result', () => {
    render(<VerificationResult data={make({})} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Verified record' })).toBeInTheDocument();
    expect(screen.getByText('Omezol')).toBeInTheDocument();
  });

  it('shows the recall reason for a RECALLED result', () => {
    render(
      <VerificationResult
        data={make({
          result: 'RECALLED',
          headline: 'Recalled — do not use',
          batch: { ...batch, status: 'RECALLED', displayStatus: 'RECALLED' },
          reasons: ['This batch has been recalled by the regulator'],
          recall: { reference: 'RCL-0001', action: 'RECALL', classification: 'CLASS_I', reason: 'Dissolution failure in stability testing', createdAt: '2026-10-01T00:00:00Z' },
        })}
      />,
    );
    expect(screen.getByText(/Dissolution failure in stability testing/)).toBeInTheDocument();
    expect(screen.queryByText('Verified record')).not.toBeInTheDocument();
  });

  it.each(['VERIFIED', 'SUSPICIOUS', 'UNKNOWN', 'RECALLED', 'EXPIRED'] as const)('always renders the disclaimer (%s)', (result) => {
    render(<VerificationResult data={make({ result, batch: result === 'UNKNOWN' ? null : batch })} />);
    expect(screen.getByText(DISCLAIMER)).toBeInTheDocument();
  });
});
