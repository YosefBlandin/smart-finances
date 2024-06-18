## Smart Finances

Smart Finances is a project designed to simplify the often-complex task of managing your finances. It provides a user-friendly interface for tracking income and expenses, creating budgets, and gaining valuable insights into your financial health.

### Getting Started (**Prerequisites:** Node.js and Angular CLI)

1. Clone the repository:

```bash
git clone https://your-repository-url.git
```

2. Install dependencies:

```bash
npm install
```

3. Run the development server:

```bash
npm start
```

This will start the application on your local machine, usually at http://localhost:4200/.

### Script Reference

The `scripts` section in the `package.json` file defines various commands for managing the project. Here's a breakdown of each command:

* **ng:** This is a shortcut for the Angular CLI, a command-line tool for developing Angular applications.

* **start (ng serve):** Starts the development server, which provides live reload functionality as you make changes to the code. This is ideal for working on the project and seeing the immediate effects of your modifications.

* **build (ng build):** Creates an optimized production build of the application. This build is intended for deployment to a hosting environment where users can access the application.

* **watch (ng build --watch --configuration development):** Starts the development server in watch mode. This means that whenever you make changes to the source code, the application will automatically rebuild and reload in the browser, saving you the time of manually running the build command.

* **test (ng test):** Runs unit tests for the application. Unit tests are essential for ensuring the functionality of individual components and preventing regressions as the code evolves.

* **serve:ssr:smart (node dist/smart/server/server.mjs):** Starts the server-side rendering (SSR) mode for the application.  SSR improves SEO (Search Engine Optimization) and initial load performance by rendering the application on the server instead of the client's browser. This can be beneficial for complex applications or those targeting search engines.
