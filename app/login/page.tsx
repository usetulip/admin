import { AdminAuthRedirect } from "@/components/auth-redirect"
import { LoginForm } from "@/components/login-form"

export default function LoginPage() {
  return (
    <AdminAuthRedirect>
      <div className="flex min-h-svh flex-col items-center justify-center bg-muted p-6 md:p-10">
        <div className="w-full max-w-sm">
          <LoginForm />
        </div>
      </div>
    </AdminAuthRedirect>
  )
}
