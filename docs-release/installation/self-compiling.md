# Self-Compiling from Source

This guide provides step-by-step instructions for developers who want to compile and run the application from source.

## Prerequisites

Before you begin, ensure you have the following installed on your system:

- **Node.js**: v18 or higher
- **pnpm**: v10+ (specifically `10.33.0` is recommended)
- **Git**

## Step-by-Step Instructions

### 1. Clone the Repository

Clone the project repository to your local machine using Git:

```bash
git clone <repository-url>
cd <repository-directory>
```

### 2. Install Dependencies

Use `pnpm` to install all required dependencies:

```bash
pnpm install
```

### 3. Configure Environment Variables

The application requires environment variables to function correctly. You can find a template in the `.env.example` file located in the root of the project.

Copy the `.env.example` file to create your own `.env` file:

```bash
cp .env.example .env
```

Open the newly created `.env` file and populate the necessary values (e.g., `JULES_API_KEY`, `DASHBOARD_PORT`).

### 4. Start the Local Dev Server

Start the local development server:

```bash
pnpm run dev
```

## Expected Result

Once the development server has started successfully, you should see terminal output indicating the server is running. You can then access the dashboard in your browser at `http://localhost:4444` (or the port specified in your `.env` file).

::: info
If you encounter any issues during the build process, ensure your Node.js and pnpm versions match the prerequisites exactly before opening an issue.
:::