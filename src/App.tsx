import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from './app/AuthProvider'
import { ThemeProvider } from './app/ThemeProvider'
import { AppShell, ComingSoon } from './app/AppShell'
import { RequireAdmin, RequireAuth } from './app/guards'
import { LoginPage } from './features/auth/LoginPage'

/*
  HashRouter, not BrowserRouter: GitHub Pages cannot rewrite unknown paths to
  index.html, so /bookings/123 would 404 on refresh (ARCHITECTURE.md §10).
*/

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
})

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <HashRouter>
            <Routes>
              <Route path="/login" element={<LoginPage />} />

              <Route
                element={
                  <RequireAuth>
                    <AppShell />
                  </RequireAuth>
                }
              >
                <Route
                  index
                  element={
                    <ComingSoon
                      title="Dashboard"
                      note="Occupancy, arrivals and departures will appear here once bookings are built."
                    />
                  }
                />
                <Route
                  path="bookings"
                  element={
                    <ComingSoon
                      title="Bookings"
                      note="The booking list and month calendar are the next thing to be built."
                    />
                  }
                />
                <Route
                  path="guest-houses"
                  element={
                    <RequireAdmin>
                      <ComingSoon
                        title="Guest Houses"
                        note="Add guest houses and configure their rooms here."
                      />
                    </RequireAdmin>
                  }
                />
                <Route
                  path="room-types"
                  element={
                    <RequireAdmin>
                      <ComingSoon
                        title="Room Types"
                        note="Define the room categories used across your guest houses."
                      />
                    </RequireAdmin>
                  }
                />
                <Route
                  path="users"
                  element={
                    <RequireAdmin>
                      <ComingSoon
                        title="Users"
                        note="Invite staff and assign roles here."
                      />
                    </RequireAdmin>
                  }
                />
              </Route>

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </HashRouter>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  )
}
