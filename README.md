# Aggregator App - Backend Server

Express.js + MongoDB backend for the Aggregator App with separate authentication systems for Users and Agencies.

## Features

- 🔐 Dual Authentication System (Users & Agencies)
- 🏢 Agency Directory (SIM, Bank, Insurance, Visa, Travel)
- 🏠 Property Marketplace
- 📧 Lead Management (Property Interests & Agency Inquiries)
- 👨‍💼 Admin Panel Backend

## Tech Stack

- Express.js
- MongoDB + Mongoose
- JWT Authentication (httpOnly cookies)
- bcrypt for password hashing
- CORS enabled

## Setup

### 1. Install Dependencies

```bash
cd server
npm install
```

### 2. Configure Environment

Create a `.env` file based on `env.example`:

```bash
cp env.example .env
```

Edit `.env` with your configuration:

```
PORT=3005
MONGODB_URI=mongodb://localhost:27017/aggregator-app
JWT_SECRET=your-secret-key-change-this-in-production
CORS_ORIGIN=http://localhost:3000
```

### 3. Start MongoDB

Make sure MongoDB is running on your system:

```bash
# macOS with Homebrew
brew services start mongodb-community

# Linux
sudo systemctl start mongod

# Or use MongoDB Atlas (cloud)
```

### 4. Seed Database

Run the seed script to create admin user and sample data:

```bash
npm run seed
```

This will create:

- Admin user: `admin@demo.com` / `Admin@123`
- Customer user: `customer@demo.com` / `Customer@123`
- 5 sample agencies (all with password: `Agency@123`)
- 6 sample properties

### 5. Start Development Server

```bash
npm run dev
```

Server will run on `https://aggregator-server.safeaven.com`

## API Endpoints

### User Authentication

- `POST /api/users/register` - Register new user
- `POST /api/users/login` - User login
- `GET /api/users/me` - Get logged-in user profile
- `POST /api/users/logout` - Logout

### Agency Authentication

- `POST /api/agencies/register` - Register new agency
- `POST /api/agencies/login` - Agency login
- `GET /api/agencies/me` - Get logged-in agency profile
- `PATCH /api/agencies/me` - Update agency profile
- `POST /api/agencies/logout` - Logout

### Agencies

- `GET /api/agencies` - List all agencies (filters: category, city, country, limit)
- `GET /api/agencies/:id` - Get agency details
- `POST /api/agencies/:id/contact` - Contact agency (create inquiry)

### Properties

- `GET /api/properties` - List all properties (filters: country, city, minPrice, maxPrice, q, limit)
- `GET /api/properties/:id` - Get property details
- `POST /api/properties` - Create property (auth required)
- `POST /api/properties/:id/interest` - Submit interest in property
- `GET /api/my/properties` - Get my properties (auth required)
- `GET /api/my/interests` - Get interests on my properties (auth required)

### Admin

- `POST /api/admin/login` - Admin login
- `GET /api/admin/dashboard` - Dashboard summary
- `GET /api/admin/users` - List all users
- `GET /api/admin/agencies` - List all agencies
- `PATCH /api/admin/agencies/:id/approve` - Approve agency
- `DELETE /api/admin/agencies/:id` - Delete agency
- `GET /api/admin/properties` - List all properties
- `DELETE /api/admin/properties/:id` - Delete property
- `GET /api/admin/interests` - List all property interests
- `GET /api/admin/inquiries` - List all agency inquiries

## Models

### User

- name, email (unique), phone, passwordHash, role (CUSTOMER/ADMIN)

### Agency

- name, email (unique), passwordHash, category [], about, phone, website, address, city, country, logoUrl, isApproved

### Property

- ownerType (USER/AGENCY), owner (ref), title, description, price, currency, city, country, photos [], active

### Interest

- property (ref), name, phone, email, message

### AgencyInquiry

- agency (ref), name, phone, email, message

## Scripts

- `npm run dev` - Start development server with auto-reload
- `npm start` - Start production server
- `npm run seed` - Seed database with sample data

## Authentication Flow

JWT tokens are stored in httpOnly cookies for security. The system supports three types of authentication:

- USER (regular customers)
- AGENCY (service providers)
- ADMIN (system administrators)

Each type has separate login endpoints and permissions.
