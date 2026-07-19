'use client'

import { useRef, useState, useCallback, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useQueryClient } from '@tanstack/react-query'
import {
  User,
  Shield,
  SlidersHorizontal,
  Palette,
  Users,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Upload,
  Trash2,
  Eye,
  EyeOff,
  ChevronLeft,
  ChevronRight,
  PlayCircle,
} from 'lucide-react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { useUIStore, THEMES } from '@/store/ui.store'
import type { Theme } from '@/store/ui.store'
import {
  useMyProfile,
  useUpdateProfile,
  useUploadAvatar,
  useDeleteAvatar,
  useUpdatePreferences,
  useChangePassword,
  useInvalidateSessions,
  useAllUsers,
  useUpdateUserRole,
  useSetUserStatus,
  useAvatarUrl,
  useTriggerDailyAnalytics,
} from '@/hooks/useSettings'
import type { UserRole } from '@/types/developer.types'
import { LoginActivitySection } from '@/components/settings/LoginActivitySection'

// ── Types ─────────────────────────────────────────────────────────────────────

type Tab = 'profile' | 'security' | 'preferences' | 'appearance' | 'admin'

interface TabDef {
  id: Tab
  label: string
  icon: React.ElementType
  roles?: UserRole[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const TABS: TabDef[] = [
  { id: 'profile',     label: 'Profile',     icon: User },
  { id: 'security',    label: 'Security',    icon: Shield },
  { id: 'preferences', label: 'Preferences', icon: SlidersHorizontal },
  { id: 'appearance',  label: 'Appearance',  icon: Palette },
  { id: 'admin',       label: 'User Admin',  icon: Users, roles: ['admin'] },
]

function initials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
}

// ── Toast-style inline feedback ───────────────────────────────────────────────

function StatusLine({ ok, msg }: { ok?: boolean; msg?: string }) {
  if (!msg) return null
  return (
    <p className={cn('mt-2 flex items-center gap-1.5 text-xs', ok ? 'text-emerald-500' : 'text-destructive')}>
      {ok ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />}
      {msg}
    </p>
  )
}

// ── Section heading ───────────────────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-4 text-sm font-semibold text-foreground">{children}</h3>
}

// ── Profile tab ───────────────────────────────────────────────────────────────

function ProfileTab() {
  const { data: profile, isLoading } = useMyProfile()
  const updateProfile = useUpdateProfile()
  const uploadAvatar = useUploadAvatar()
  const deleteAvatar = useDeleteAvatar()
  const fileRef = useRef<HTMLInputElement>(null)
  const qc = useQueryClient()
  const avatarBlobUrl = useAvatarUrl(profile?.hasAvatar ?? false)

  const [name, setName] = useState('')
  const [team, setTeam] = useState('')
  const [profileMsg, setProfileMsg] = useState<{ ok: boolean; msg: string } | null>(null)
  const [avatarMsg, setAvatarMsg] = useState<{ ok: boolean; msg: string } | null>(null)

  useEffect(() => {
    if (profile) {
      setName(profile.name ?? '')
      setTeam(profile.team ?? '')
    }
  }, [profile])

  const handleSaveProfile = async () => {
    setProfileMsg(null)
    try {
      await updateProfile.mutateAsync({ name: name.trim() || undefined, team: team.trim() || undefined })
      setProfileMsg({ ok: true, msg: 'Profile updated' })
    } catch {
      setProfileMsg({ ok: false, msg: 'Failed to update profile' })
    }
  }

  const handleAvatarFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 2 * 1024 * 1024) {
      setAvatarMsg({ ok: false, msg: 'File must be under 2 MB' })
      return
    }
    setAvatarMsg(null)
    const reader = new FileReader()
    reader.onload = async (ev) => {
      const raw = ev.target?.result as string
      // raw is "data:image/png;base64,xxxx" — strip the prefix
      const [, b64] = raw.split(',')
      try {
        await uploadAvatar.mutateAsync({ data: b64, mimeType: file.type })
        setAvatarMsg({ ok: true, msg: 'Avatar updated' })
        qc.invalidateQueries({ queryKey: ['settings', 'profile'] })
      } catch {
        setAvatarMsg({ ok: false, msg: 'Upload failed. Check file type and size.' })
      }
    }
    reader.readAsDataURL(file)
    // Reset input so the same file can be re-uploaded
    e.target.value = ''
  }, [uploadAvatar, qc])

  const handleDeleteAvatar = async () => {
    setAvatarMsg(null)
    try {
      await deleteAvatar.mutateAsync()
      setAvatarMsg({ ok: true, msg: 'Avatar removed' })
    } catch {
      setAvatarMsg({ ok: false, msg: 'Failed to remove avatar' })
    }
  }

  if (isLoading) return <Skeleton className="h-64 w-full rounded-lg" />

  return (
    <div className="space-y-6">
      {/* Avatar */}
      <Card>
        <CardContent className="pt-6">
          <SectionTitle>Profile Picture</SectionTitle>
          <div className="flex items-center gap-4">
            <Avatar className="h-16 w-16">
              {avatarBlobUrl && (
                <AvatarImage src={avatarBlobUrl} alt={profile?.name} />
              )}
              <AvatarFallback className="text-lg font-semibold">
                {initials(profile?.name ?? 'U')}
              </AvatarFallback>
            </Avatar>
            <div className="space-y-2">
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploadAvatar.isPending}
                >
                  {uploadAvatar.isPending ? (
                    <Loader2 size={13} className="mr-1.5 animate-spin" />
                  ) : (
                    <Upload size={13} className="mr-1.5" />
                  )}
                  Upload
                </Button>
                {profile?.hasAvatar && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    onClick={handleDeleteAvatar}
                    disabled={deleteAvatar.isPending}
                  >
                    <Trash2 size={13} className="mr-1.5" />
                    Remove
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">JPEG, PNG, WebP or GIF · max 2 MB</p>
              <StatusLine ok={avatarMsg?.ok} msg={avatarMsg?.msg} />
            </div>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="hidden"
            onChange={handleAvatarFile}
          />
        </CardContent>
      </Card>

      {/* Identity */}
      <Card>
        <CardContent className="pt-6">
          <SectionTitle>Identity</SectionTitle>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Display name</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Team</label>
              <Input value={team} onChange={(e) => setTeam(e.target.value)} placeholder="e.g. Frontend" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Email</label>
              <Input value={profile?.email ?? ''} disabled className="opacity-60" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Role</label>
              <div className="flex h-9 items-center">
                <Badge variant="secondary" className="capitalize">{profile?.role}</Badge>
              </div>
            </div>
            {profile?.azureDevOpsId && (
              <div className="space-y-1.5 sm:col-span-2">
                <label className="text-xs font-medium text-muted-foreground">Azure DevOps ID</label>
                <Input value={profile.azureDevOpsId} disabled className="font-mono opacity-60" />
              </div>
            )}
          </div>
          <div className="mt-4 flex items-center gap-3">
            <Button
              size="sm"
              onClick={handleSaveProfile}
              disabled={updateProfile.isPending}
            >
              {updateProfile.isPending && <Loader2 size={13} className="mr-1.5 animate-spin" />}
              Save changes
            </Button>
            <StatusLine ok={profileMsg?.ok} msg={profileMsg?.msg} />
          </div>
        </CardContent>
      </Card>

      {/* Account info */}
      <Card>
        <CardContent className="pt-6">
          <SectionTitle>Account Info</SectionTitle>
          <div className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <p className="text-xs text-muted-foreground">Account status</p>
              <Badge variant={profile?.isActive ? 'default' : 'destructive'} className="mt-1">
                {profile?.isActive ? 'Active' : 'Inactive'}
              </Badge>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Member since</p>
              <p className="mt-0.5 font-medium">
                {profile?.createdAt ? new Date(profile.createdAt).toLocaleDateString() : '—'}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Last login</p>
              <p className="mt-0.5 font-medium">
                {profile?.lastLoginAt ? new Date(profile.lastLoginAt).toLocaleString() : '—'}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ── Security tab ──────────────────────────────────────────────────────────────

function SecurityTab() {
  const changePassword = useChangePassword()
  const invalidateSessions = useInvalidateSessions()

  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; msg: string } | null>(null)
  const [sessMsg, setSessMsg] = useState<{ ok: boolean; msg: string } | null>(null)

  const handleChangePassword = async () => {
    setPwMsg(null)
    if (next !== confirm) {
      setPwMsg({ ok: false, msg: 'New passwords do not match' })
      return
    }
    if (next.length < 8) {
      setPwMsg({ ok: false, msg: 'Password must be at least 8 characters' })
      return
    }
    try {
      await changePassword.mutateAsync({ currentPassword: current, newPassword: next })
      setPwMsg({ ok: true, msg: 'Password changed successfully' })
      setCurrent(''); setNext(''); setConfirm('')
    } catch {
      setPwMsg({ ok: false, msg: 'Incorrect current password or request failed' })
    }
  }

  const handleInvalidateSessions = async () => {
    setSessMsg(null)
    try {
      await invalidateSessions.mutateAsync()
      setSessMsg({ ok: true, msg: 'All other sessions have been signed out' })
    } catch {
      setSessMsg({ ok: false, msg: 'Failed to invalidate sessions' })
    }
  }

  const inputType = showPw ? 'text' : 'password'

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="pt-6">
          <SectionTitle>Change Password</SectionTitle>
          <div className="max-w-sm space-y-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Current password</label>
              <div className="relative">
                <Input
                  type={inputType}
                  value={current}
                  onChange={(e) => setCurrent(e.target.value)}
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                >
                  {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">New password</label>
              <Input type={inputType} value={next} onChange={(e) => setNext(e.target.value)} placeholder="Min 8 characters" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Confirm new password</label>
              <Input type={inputType} value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Repeat new password" />
            </div>
            <Button
              size="sm"
              onClick={handleChangePassword}
              disabled={!current || !next || !confirm || changePassword.isPending}
            >
              {changePassword.isPending && <Loader2 size={13} className="mr-1.5 animate-spin" />}
              Update password
            </Button>
            <StatusLine ok={pwMsg?.ok} msg={pwMsg?.msg} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <SectionTitle>Active Sessions</SectionTitle>
          <p className="mb-4 text-sm text-muted-foreground">
            Sign out all other devices. Your current session will remain active.
          </p>
          <Button
            size="sm"
            variant="outline"
            className="border-destructive text-destructive hover:bg-destructive/10"
            onClick={handleInvalidateSessions}
            disabled={invalidateSessions.isPending}
          >
            {invalidateSessions.isPending && <Loader2 size={13} className="mr-1.5 animate-spin" />}
            Sign out all other sessions
          </Button>
          <StatusLine ok={sessMsg?.ok} msg={sessMsg?.msg} />
        </CardContent>
      </Card>
    </div>
  )
}

// ── Preferences tab ───────────────────────────────────────────────────────────

function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  description?: string
}) {
  return (
    <div className="flex items-center justify-between py-3">
      <div>
        <p className="text-sm font-medium">{label}</p>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors',
          'focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2',
          checked ? 'bg-primary' : 'bg-muted',
        )}
      >
        <span
          className={cn(
            'pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-4' : 'translate-x-0',
          )}
        />
      </button>
    </div>
  )
}

function PreferencesTab() {
  const { data: profile, isLoading } = useMyProfile()
  const updatePreferences = useUpdatePreferences()

  const prefs = profile?.preferences
  const [emailNotifications, setEmailNotifications] = useState(true)
  const [weeklyDigest, setWeeklyDigest] = useState(true)
  const [showEfficiencyScore, setShowEfficiencyScore] = useState(true)
  const [defaultPeriod, setDefaultPeriod] = useState<'daily' | 'monthly'>('daily')
  const [msg, setMsg] = useState<{ ok: boolean; msg: string } | null>(null)

  useEffect(() => {
    if (prefs) {
      setEmailNotifications(prefs.emailNotifications)
      setWeeklyDigest(prefs.weeklyDigest)
      setShowEfficiencyScore(prefs.showEfficiencyScore)
      setDefaultPeriod(prefs.defaultPeriod)
    }
  }, [prefs])

  const handleSave = async () => {
    setMsg(null)
    try {
      await updatePreferences.mutateAsync({
        emailNotifications,
        weeklyDigest,
        showEfficiencyScore,
        defaultPeriod,
      })
      setMsg({ ok: true, msg: 'Preferences saved' })
    } catch {
      setMsg({ ok: false, msg: 'Failed to save preferences' })
    }
  }

  if (isLoading) return <Skeleton className="h-64 w-full rounded-lg" />

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="pt-6">
          <SectionTitle>Notifications</SectionTitle>
          <div className="divide-y divide-border">
            <Toggle
              checked={emailNotifications}
              onChange={setEmailNotifications}
              label="Email notifications"
              description="Receive alerts and summaries via email"
            />
            <Toggle
              checked={weeklyDigest}
              onChange={setWeeklyDigest}
              label="Weekly digest"
              description="Get a weekly summary of team activity"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <SectionTitle>Dashboard</SectionTitle>
          <div className="divide-y divide-border">
            <Toggle
              checked={showEfficiencyScore}
              onChange={setShowEfficiencyScore}
              label="Show efficiency score"
              description="Display the efficiency gauge on developer profiles"
            />
          </div>
          <div className="mt-4 space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Default analytics period</label>
            <Select value={defaultPeriod} onValueChange={(v) => setDefaultPeriod(v as 'daily' | 'monthly')}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">Daily</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button size="sm" onClick={handleSave} disabled={updatePreferences.isPending}>
          {updatePreferences.isPending && <Loader2 size={13} className="mr-1.5 animate-spin" />}
          Save preferences
        </Button>
        <StatusLine ok={msg?.ok} msg={msg?.msg} />
      </div>
    </div>
  )
}

// ── Appearance tab ────────────────────────────────────────────────────────────

function AppearanceTab() {
  const { theme, setTheme } = useUIStore()

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="pt-6">
          <SectionTitle>Theme</SectionTitle>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {THEMES.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => setTheme(t.value as Theme)}
                className={cn(
                  'flex flex-col items-center gap-2 rounded-lg border-2 p-3 text-center transition-colors',
                  theme === t.value
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-muted-foreground/40 hover:bg-muted/50',
                )}
              >
                <span className="text-xl leading-none">{t.icon}</span>
                <span className="text-xs font-medium">{t.label}</span>
                <span className="text-[10px] text-muted-foreground leading-tight">{t.description}</span>
                {theme === t.value && (
                  <CheckCircle2 size={12} className="text-primary" />
                )}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function yesterdayStr(): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

// ── Admin tab ─────────────────────────────────────────────────────────────────

const ROLE_OPTIONS: UserRole[] = ['admin', 'manager']

function AdminTab({ currentUserId }: { currentUserId: string }) {
  const [page, setPage] = useState(1)
  const { data, isLoading, isFetching } = useAllUsers(page, 15)
  const updateRole = useUpdateUserRole()
  const setStatus = useSetUserStatus()
  const [actionMsg, setActionMsg] = useState<{ id: string; ok: boolean; msg: string } | null>(null)

  // ── Daily analytics trigger ───────────────────────────────────────────────
  const triggerAnalytics = useTriggerDailyAnalytics()
  const [triggerDate, setTriggerDate] = useState(yesterdayStr)
  const [triggerMsg, setTriggerMsg] = useState<{ ok: boolean; msg: string } | null>(null)

  const handleTriggerAnalytics = async () => {
    setTriggerMsg(null)
    try {
      const result = await triggerAnalytics.mutateAsync(triggerDate || undefined)
      const count = (result?.upserted ?? 0) + (result?.updated ?? 0)
      setTriggerMsg({
        ok: true,
        msg: `Done — ${count} developer${count !== 1 ? 's' : ''} processed for ${result?.date ?? triggerDate}`,
      })
    } catch {
      setTriggerMsg({ ok: false, msg: 'Build failed or already running. Check server logs.' })
    }
  }

  const handleRoleChange = async (id: string, role: UserRole) => {
    setActionMsg(null)
    try {
      await updateRole.mutateAsync({ id, role })
      setActionMsg({ id, ok: true, msg: 'Role updated' })
    } catch {
      setActionMsg({ id, ok: false, msg: 'Failed to update role' })
    }
  }

  const handleStatusToggle = async (id: string, isActive: boolean) => {
    setActionMsg(null)
    try {
      await setStatus.mutateAsync({ id, isActive })
      setActionMsg({ id, ok: true, msg: isActive ? 'Account activated' : 'Account deactivated' })
    } catch {
      setActionMsg({ id, ok: false, msg: 'Failed to update status' })
    }
  }

  return (
    <div className="space-y-4">
      {/* ── Login activity (admin audit) ─────────────────────────────── */}
      <LoginActivitySection />

      {/* ── Daily Analytics trigger ──────────────────────────────────── */}
      <Card>
        <CardContent className="pt-6">
          <SectionTitle>Daily Analytics</SectionTitle>
          <p className="mb-4 text-sm text-muted-foreground">
            Trigger an on-demand recalculation of daily developer summaries without waiting for the
            nightly cron job. Only one build can run at a time.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Target date</label>
              <Input
                type="date"
                value={triggerDate}
                onChange={(e) => setTriggerDate(e.target.value)}
                className="w-40"
                disabled={triggerAnalytics.isPending}
              />
            </div>
            <Button
              size="sm"
              onClick={handleTriggerAnalytics}
              disabled={triggerAnalytics.isPending || !triggerDate}
            >
              {triggerAnalytics.isPending ? (
                <>
                  <Loader2 size={13} className="mr-1.5 animate-spin" />
                  Processing…
                </>
              ) : (
                <>
                  <PlayCircle size={13} className="mr-1.5" />
                  Run Daily Analytics
                </>
              )}
            </Button>
          </div>
          <StatusLine ok={triggerMsg?.ok} msg={triggerMsg?.msg} />
        </CardContent>
      </Card>

      {/* ── User management ──────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">
              Users
              {data && (
                <span className="ml-2 font-normal text-muted-foreground">
                  ({data.total} total)
                </span>
              )}
            </h3>
            {isFetching && <Loader2 size={14} className="animate-spin text-muted-foreground" />}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full rounded" />
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="px-4 py-2.5 font-medium">User</th>
                    <th className="px-4 py-2.5 font-medium">Team</th>
                    <th className="px-4 py-2.5 font-medium">Role</th>
                    <th className="px-4 py-2.5 font-medium">Status</th>
                    <th className="px-4 py-2.5 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.items.map((u) => {
                    const isSelf = u.id === currentUserId
                    const feedback = actionMsg?.id === u.id ? actionMsg : null
                    return (
                      <tr key={u.id} className="border-b border-border/50 hover:bg-muted/30">
                        <td className="px-4 py-3">
                          <div className="font-medium">{u.name || u.displayName || u.email}</div>
                          <div className="text-xs text-muted-foreground">{u.email}</div>
                          {feedback && (
                            <p className={cn('text-xs mt-0.5', feedback.ok ? 'text-emerald-500' : 'text-destructive')}>
                              {feedback.msg}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{u.team ?? '—'}</td>
                        <td className="px-4 py-3">
                          {isSelf ? (
                            <Badge variant="secondary" className="capitalize">{u.role}</Badge>
                          ) : (
                            <Select
                              value={u.role}
                              onValueChange={(v) => handleRoleChange(u.id, v as UserRole)}
                              disabled={updateRole.isPending}
                            >
                              <SelectTrigger className="h-7 w-28 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {ROLE_OPTIONS.map((r) => (
                                  <SelectItem key={r} value={r} className="text-xs capitalize">
                                    {r}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant={u.isActive ? 'default' : 'destructive'}>
                            {u.isActive ? 'Active' : 'Inactive'}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          {isSelf ? (
                            <span className="text-xs text-muted-foreground">—</span>
                          ) : (
                            <Button
                              size="sm"
                              variant="ghost"
                              className={cn(
                                'h-7 px-2 text-xs',
                                u.isActive
                                  ? 'text-destructive hover:text-destructive'
                                  : 'text-emerald-600 hover:text-emerald-600',
                              )}
                              onClick={() => handleStatusToggle(u.id, !u.isActive)}
                              disabled={setStatus.isPending}
                            >
                              {u.isActive ? 'Deactivate' : 'Activate'}
                            </Button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>Page {data.page} of {data.totalPages}</span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft size={14} />
              Prev
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={page >= data.totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
              <ChevronRight size={14} />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const { data: session } = useSession()
  const { data: profile } = useMyProfile()
  const [activeTab, setActiveTab] = useState<Tab>('profile')

  const role = (session?.user?.role ?? 'manager') as UserRole
  const visibleTabs = TABS.filter((t) => !t.roles || t.roles.includes(role))

  // Ensure the active tab is still visible (e.g. after role changes)
  const currentTab = visibleTabs.find((t) => t.id === activeTab) ? activeTab : visibleTabs[0]?.id ?? 'profile'

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">Manage your account, preferences and security settings</p>
      </div>

      <div className="flex gap-6">
        {/* Sidebar nav */}
        <nav className="w-44 shrink-0 space-y-0.5">
          {visibleTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                currentTab === tab.id
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <tab.icon size={15} className="shrink-0" />
              {tab.label}
            </button>
          ))}
        </nav>

        {/* Content */}
        <div className="min-w-0 flex-1">
          {currentTab === 'profile' && <ProfileTab />}
          {currentTab === 'security' && <SecurityTab />}
          {currentTab === 'preferences' && <PreferencesTab />}
          {currentTab === 'appearance' && <AppearanceTab />}
          {currentTab === 'admin' && (
            <AdminTab currentUserId={profile?.id ?? ''} />
          )}
        </div>
      </div>
    </div>
  )
}
