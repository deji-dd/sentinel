# Sentinel - Torn City API Authentication

A Next.js 16 authentication system using Supabase SSR for Torn City API key verification.

## Quick Start

```bash
# 1. Setup environment
cp .env.local.example .env.local
# Add your Supabase credentials to .env.local

# 2. Run database migration
# Copy SQL from supabase/migrations/create_store_user_key.sql
# Paste into Supabase SQL Editor and run

# 3. Start dev server
pnpm dev
```

Visit `http://localhost:3000` and enter a valid Torn City API key.

## How It Works

1. User enters 16-character Torn City API key on home page
2. `authenticateTornUser` server action validates the key
3. Key is verified against `https://api.torn.com/v2/key/info`
4. Access level must be 3 or 4 (rejects lower permissions)
5. User is created/signed in with email `${player_id}@sentinel.com`
6. API key is securely stored via RPC function
7. User redirected to protected `/dashboard`

## Key Features

✅ Torn City API verification  
✅ Automatic user provisioning  
✅ Secure API key storage  
✅ Protected routes via middleware  
✅ Session refresh on every request  
✅ Comprehensive error handling

## Documentation

- **[SETUP.md](./SETUP.md)** - Detailed setup instructions
- **[TORN_API_KEY_SETUP.md](./TORN_API_KEY_SETUP.md)** - Database migration guide

## Architecture

```
/app
  /actions
    └── authenticate.ts          # Torn City auth server action
  /api/auth
    ├── /login                   # Redirects to home
    ├── /logout                  # Sign out
    └── /me                      # Get current user
  /dashboard                      # Protected page
  └── page.tsx                    # Home with login form

/components/auth
  └── login-card.tsx             # Login UI component

/lib
  ├── supabase-server.ts         # Server client
  ├── supabase.ts                # Client client
  └── auth-helpers.ts            # Helper functions

middleware.ts                     # Auth middleware with session refresh
```

## Environment Variables

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

## API Endpoints

- `GET /api/auth/me` - Get current user
- `POST /api/auth/logout` - Sign out

## Troubleshooting

| Issue                                    | Solution                          |
| ---------------------------------------- | --------------------------------- |
| "Function store_user_key does not exist" | Run migration SQL in Supabase     |
| Authentication fails                     | Verify API key access level is 3+ |
| Session issues                           | Clear cookies and try again       |

See [SETUP.md](./SETUP.md) for more details.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
