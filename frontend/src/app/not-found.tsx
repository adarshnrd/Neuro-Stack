import Link from 'next/link'
import { Home } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-8">
      <Card className="w-full max-w-sm">
        <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
          <p className="text-6xl font-bold text-muted-foreground/30">404</p>
          <div>
            <h2 className="text-lg font-semibold text-foreground">Page not found</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              The page you&apos;re looking for doesn&apos;t exist or has been moved.
            </p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href="/dashboard">
              <Home size={14} className="mr-2" />
              Back to Dashboard
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
