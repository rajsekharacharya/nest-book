import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from './app/AuthProvider'
import { ThemeProvider } from './app/ThemeProvider'
import { AppShell, ComingSoon } from './app/AppShell'
import { RequireAdmin, RequireAuth } from './app/guards'
import { ToastProvider } from './components/feedback'
import { LandingPage } from './features/marketing/LandingPage'
import { LoginPage } from './features/auth/LoginPage'
import { GuestBookingPage } from './features/guest-link/GuestBookingPage'
import { BookingsPage } from './features/bookings/BookingsPage'
import { BookingFormPage } from './features/bookings/BookingFormPage'
import { BookingDetailPage } from './features/bookings/BookingDetailPage'
import { GuestHousesPage } from './features/guest-houses/GuestHousesPage'
import { GuestHouseDetailPage } from './features/guest-houses/GuestHouseDetailPage'
import { RoomTypesPage } from './features/room-types/RoomTypesPage'
import { UsersPage } from './features/users/UsersPage'

/*
  HashRouter, not BrowserRouter: GitHub Pages cannot rewrite unknown paths to
  index.html, so /bookings/123 would 404 on refresh (ARCHITECTURE.md §10).

  The signed-in application lives under /app so that / can be the public
  landing page.
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
        <ToastProvider>
          <AuthProvider>
            <HashRouter>
              <Routes>
                <Route path="/" element={<LandingPage />} />
                <Route path="/login" element={<LoginPage />} />

                {/* Public: the token is the credential, so this sits outside
                    RequireAuth. The server returns a narrow projection (§8). */}
                <Route path="/stay/:token" element={<GuestBookingPage />} />

                <Route
                  path="/app"
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
                  {/* "new" precedes ":id" so it is not read as a booking id. */}
                  <Route path="bookings" element={<BookingsPage />} />
                  <Route path="bookings/new" element={<BookingFormPage />} />
                  <Route path="bookings/:id" element={<BookingDetailPage />} />
                  <Route path="bookings/:id/edit" element={<BookingFormPage />} />
                  <Route
                    path="guest-houses"
                    element={
                      <RequireAdmin>
                        <GuestHousesPage />
                      </RequireAdmin>
                    }
                  />
                  <Route
                    path="guest-houses/:id"
                    element={
                      <RequireAdmin>
                        <GuestHouseDetailPage />
                      </RequireAdmin>
                    }
                  />
                  <Route
                    path="room-types"
                    element={
                      <RequireAdmin>
                        <RoomTypesPage />
                      </RequireAdmin>
                    }
                  />
                  <Route
                    path="users"
                    element={
                      <RequireAdmin>
                        <UsersPage />
                      </RequireAdmin>
                    }
                  />
                </Route>

                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </HashRouter>
          </AuthProvider>
        </ToastProvider>
      </ThemeProvider>
    </QueryClientProvider>
  )
}
