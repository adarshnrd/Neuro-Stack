'use client'

import { useState } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { signIn } from 'next-auth/react'
import { format, isValid, parseISO } from 'date-fns'
import { Loader2, Eye, EyeOff, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { cn } from '@/lib/utils'

// ── Validation schema ─────────────────────────────────────────────────────────

const schema = z.object({
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
})

type FormValues = z.infer<typeof schema>

// ── Error parsing ─────────────────────────────────────────────────────────────

function parseAuthError(code: string | null | undefined): string {
  if (!code) return 'An unexpected error occurred. Please try again.'

  if (
    code === 'CredentialsSignin' ||
    code === 'INVALID_CREDENTIALS' ||
    code === 'MISSING_CREDENTIALS'
  ) {
    return 'Invalid email or password.'
  }

  if (code === 'ACCOUNT_NOT_WHITELISTED') {
    return 'This account is not authorized to access DevAnalytics. Contact your administrator.'
  }

  if (code.startsWith('ACCOUNT_LOCKED')) {
    // Format: ACCOUNT_LOCKED or ACCOUNT_LOCKED:<ISO date>
    const isoStr = code.slice('ACCOUNT_LOCKED:'.length)
    const lockUntil = isoStr ? parseISO(isoStr) : null
    if (lockUntil && isValid(lockUntil)) {
      return `Account locked due to multiple failed attempts. Try again after ${format(lockUntil, 'HH:mm, MMM d')}.`
    }
    return 'Account temporarily locked due to too many failed attempts. Try again in 15 minutes.'
  }

  if (code === 'LOGIN_FAILED') {
    return 'Unable to connect. Please try again later.'
  }

  return 'An unexpected error occurred. Please try again.'
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SignInPage() {
  const router = useRouter()
  const [showPassword, setShowPassword] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) })

  const onSubmit = async (data: FormValues) => {
    setAuthError(null)
    const result = await signIn('credentials', {
      redirect: false,
      email: data.email,
      password: data.password,
    })

    if (result?.error) {
      setAuthError(parseAuthError(result.error))
      return
    }

    if (result?.ok) {
      router.push('/dashboard')
      router.refresh()
    }
  }

  return (
    <Card className="w-full max-w-sm border-zinc-800 bg-zinc-900/80 shadow-2xl backdrop-blur-sm">
      <CardHeader className="space-y-4 pb-4 pt-8">
        <div className="flex justify-center">
          <Image
            src="/mindpath-logo.webp"
            alt="Mindpath logo"
            width={200}
            height={50}
            className="h-12 w-auto object-contain"
            priority
          />
        </div>
        <div className="text-center">
          <p className="mt-1 text-sm text-zinc-500">Internal Analytics Platform</p>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 pb-8">
        {authError && (
          <Alert className="border-red-900/60 bg-red-950/40 text-red-300">
            <ShieldAlert className="h-4 w-4 text-red-400" />
            <AlertDescription className="ml-2">{authError}</AlertDescription>
          </Alert>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          {/* Email */}
          <div className="space-y-1.5">
            <label htmlFor="email" className="text-sm font-medium text-zinc-300">
              Email address
            </label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              autoFocus
              placeholder="you@company.com"
              className={cn(
                'border-zinc-700 bg-zinc-800 text-zinc-100 placeholder:text-zinc-500',
                'focus-visible:border-blue-500 focus-visible:ring-blue-500/30',
                errors.email &&
                  'border-red-600 focus-visible:border-red-500 focus-visible:ring-red-500/30',
              )}
              {...register('email')}
            />
            {errors.email && <p className="text-xs text-red-400">{errors.email.message}</p>}
          </div>

          {/* Password */}
          <div className="space-y-1.5">
            <label htmlFor="password" className="text-sm font-medium text-zinc-300">
              Password
            </label>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="••••••••"
                className={cn(
                  'border-zinc-700 bg-zinc-800 pr-10 text-zinc-100 placeholder:text-zinc-500',
                  'focus-visible:border-blue-500 focus-visible:ring-blue-500/30',
                  errors.password &&
                    'border-red-600 focus-visible:border-red-500 focus-visible:ring-red-500/30',
                )}
                {...register('password')}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                tabIndex={-1}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 transition-colors hover:text-zinc-300"
              >
                {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
            {errors.password && <p className="text-xs text-red-400">{errors.password.message}</p>}
          </div>

          <Button
            type="submit"
            disabled={isSubmitting}
            className="w-full bg-blue-600 text-white hover:bg-blue-500 focus-visible:ring-blue-500"
          >
            {isSubmitting ? (
              <>
                <Loader2 size={15} className="mr-2 animate-spin" />
                Signing in…
              </>
            ) : (
              'Sign in'
            )}
          </Button>
        </form>

        <p className="text-center text-xs text-zinc-600">
          Access restricted to authorized personnel only.
        </p>
      </CardContent>
    </Card>
  )
}
