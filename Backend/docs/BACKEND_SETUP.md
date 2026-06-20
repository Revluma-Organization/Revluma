1. Firstly Clone the repo in your local machine https://github.com/Revluma-Organization/Revluma.git
git clone https://github.com/Revluma-Organization/Revluma.git

2. Install Dependencies
Navigate directly into the folder containing your backend package.json file and install the node modules:

Bash
cd Backend
npm install

3. Set Up the Environment Variables (.env)
Create a plaintext file named precisely .env at the root of your Backend/ folder directory:

Plaintext
C:\\Users\\X1\\Revluma-Backend-Repo\\Backend\\.env
Open the file and add the following configuration variables:

# Server Configuration
PORT= process.env.PORT 

# Prisma Direct Database Migration URL
DATABASE_URL= process.env.DATABASE_URL

# Explicit Connection Pool Parameters (Supabase Transaction Pooler -)
  user: process.env.DATABASE_USER
  host: process.env.DATABASE_HOST
  database: 'postgres'
  password: process.env.DATABASE_PASSWORD
  port: process.env.DATABASE_PORT

Environment Variables BreakdownVariable NameRequired TypeDescriptionPORTIntegerThe local port that the Express server listens to.
1. In the `Backend/` directory, copy the provided `.env` template to create your local active configuration file:
   ```bash
   cp .env

DATABASE_URL Connection StringUsed strictly by Prisma's migration engine to map schemas and run database alterations over port 5432.
DB_USER StringThe database user identifier passed to the native pg Pool driver adapter.
DB_HOST String DomainThe connection pooler proxy endpoint address provided by Supabase.
DB_NAME StringThe database catalog instance name (usually postgres).
DB_PASSWORD StringThe explicit database password credential. Stored separately to bypass string parsing errors.
DB_PORT IntegerConnection pooler port (6543) optimized for transaction management without SSL enforcement bugs.

4. Run Database Migrations
Synchronize your local Prisma relational schema layout with the active database tables:

Bash
npx prisma migrate dev --name init

Note: If the remote database layout is already matching, you can run npx prisma generate to build your local client objects instead.

5. Start the Server Locally
Launch your development server with nodemon hot-reloading:

Bash
npm run dev
Expected Success Logs:

Server is running on port 8080
PostgreSQL Database connected successfully via Driver Adapter to Supabase.

6. Database Administration via Prisma Studio
Prisma includes an integrated visual UI to view, filter, edit, or delete database rows (such as the records inside your waitlist_users table) from your browser.

Open a separate terminal split window.
Ensure you are in the Backend/ directory.

Run the following command:
Bash
npx prisma studio

7. System & Database Requirements
Required Node.js Version: v24.13.0 (Verify using node -v)
Required PostgreSQL Version: v15.0 or higher