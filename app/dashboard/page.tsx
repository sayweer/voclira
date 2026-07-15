import { redirect } from 'next/navigation'

// The dashboard renders inside the app/page.tsx state machine — this route only
// exists so a direct /dashboard visit doesn't land on a blank page.
export default function DashboardPage() {
  redirect('/')
}
