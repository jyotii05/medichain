import { Link } from 'react-router';
import { Compass } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/shared/States';
import { Logo } from '@/components/layout/Logo';

export default function NotFoundPage({ inApp }: { inApp?: boolean }) {
  const content = (
    <EmptyState
      icon={<Compass />}
      title="Page not found"
      description="The page you’re looking for doesn’t exist or may have moved."
      action={
        <Link to={inApp ? '/app' : '/'}>
          <Button>{inApp ? 'Back to dashboard' : 'Go home'}</Button>
        </Link>
      }
    />
  );
  if (inApp) return content;
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-8 bg-canvas p-6">
      <Logo />
      {content}
    </div>
  );
}
