import { createBrowserRouter, Navigate, RouterProvider } from 'react-router'
import { AuthProvider } from './auth/AuthProvider.tsx'
import { Gate } from './auth/Gate.tsx'
import { CheckEmail } from './pages/CheckEmail.tsx'
import { ForgotPassword } from './pages/ForgotPassword.tsx'
import { Home } from './pages/Home.tsx'
import { Onboarding } from './pages/Onboarding.tsx'
import { ResetPassword } from './pages/ResetPassword.tsx'
import { SignIn } from './pages/SignIn.tsx'
import { SignUp } from './pages/SignUp.tsx'

const router = createBrowserRouter([
  {
    element: <Gate area="guest" />,
    children: [
      { path: '/sign-in', element: <SignIn /> },
      { path: '/sign-up', element: <SignUp /> },
      { path: '/check-email', element: <CheckEmail /> },
      { path: '/forgot-password', element: <ForgotPassword /> },
    ],
  },
  {
    element: <Gate area="onboarding" />,
    children: [{ path: '/onboarding', element: <Onboarding /> }],
  },
  {
    element: <Gate area="account" />,
    children: [{ path: '/reset-password', element: <ResetPassword /> }],
  },
  {
    element: <Gate area="app" />,
    children: [{ path: '/', element: <Home /> }],
  },
  { path: '*', element: <Navigate to="/" replace /> },
])

function App() {
  return (
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  )
}

export default App
