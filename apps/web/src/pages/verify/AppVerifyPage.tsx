import { Link, useParams } from 'react-router';
import { Route as RouteIcon } from 'lucide-react';
import { PageHeader } from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/button';
import { VerifyWorkbench } from '@/components/verify/VerifyWorkbench';

export default function AppVerifyPage() {
  const { code } = useParams();
  return (
    <>
      <PageHeader
        title="Verify medicine"
        description="Verify before dispensing: scan the pack QR code to confirm the batch is registered, not recalled or expired, and has a consistent custody history."
        breadcrumbs={code ? [{ label: 'Verify medicine', to: '/app/verify' }, { label: code.toUpperCase() }] : undefined}
      />
      <VerifyWorkbench
        code={code}
        basePath="/app/verify"
        context="app"
        resultActions={(d) =>
          d.batch ? (
            <Link to={`/app/batches?q=${encodeURIComponent(d.batch.publicId)}`}>
              <Button variant="secondary" className="w-full">
                <RouteIcon /> Open in tracking
              </Button>
            </Link>
          ) : null
        }
      />
    </>
  );
}
