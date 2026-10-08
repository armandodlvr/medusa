import { Spinner } from "@medusajs/icons"
import { Navigate, Outlet, useLocation } from "react-router-dom"
import { useMe } from "../../../hooks/api/users"
import { SearchProvider } from "../../../providers/search-provider"
import { SidebarProvider } from "../../../providers/sidebar-provider"

export const ProtectedRoute = () => {
  const location = useLocation()

  const { user, isLoading: isLoadingUser } = useMe()

  if (isLoadingUser) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner className="text-ui-fg-interactive animate-spin" />
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  return (
    <SidebarProvider>
      <SearchProvider>
        <Outlet />
      </SearchProvider>
    </SidebarProvider>
  )
}
