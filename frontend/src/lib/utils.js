import { clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs) {
  return twMerge(clsx(inputs))
}

export function formatDate(date) {
  if (!date) return 'Never'
  return new Date(date).toLocaleString()
}

export function formatRelativeTime(date) {
  if (!date) return 'Never'

  const now = new Date()
  const then = new Date(date)
  const diffMs = now - then
  const future = diffMs < 0
  const absMs = Math.abs(diffMs)
  const diffMins = Math.floor(absMs / 60000)

  // Helper: prefix for future vs past timestamps.
  const fmt = (value) => future ? `in ${value}` : `${value} ago`

  if (diffMins < 1) return future ? 'in <1m' : 'Just now'
  if (diffMins < 60) return fmt(`${diffMins}m`)

  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return fmt(`${diffHours}h`)

  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 7) return fmt(`${diffDays}d`)

  return formatDate(date)
}
