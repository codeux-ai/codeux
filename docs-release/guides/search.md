# Global Search Guide

Learn how to navigate the app quickly using global search, supported operators, and complex queries.

::: info
This guide is intended for power users who want to speed up their workflow using advanced search capabilities.
:::

## Before you start
* Familiarize yourself with the main application interface.
* Ensure you are logged into your workspace.

## Steps

1. **Open Global Search**
   Press `Cmd+K` (or `Ctrl+K` on Windows) from anywhere in the application to immediately open the **Global Search** dialog.

2. **Use Search Operators**
   Type your query using search operators to narrow down your results. Below is a reference table of supported search operators:

   | Operator | Description | Example |
   |----------|-------------|---------|
   | `is:open` | Filters for open tasks or projects | `is:open` |
   | `is:closed` | Filters for closed tasks or projects | `is:closed` |
   | `assignee:me` | Filters for items assigned to you | `assignee:me bug` |
   | `assignee:[username]` | Filters for items assigned to a specific user | `assignee:jules` |
   | `project:[name]` | Filters for items within a specific project | `project:website` |

3. **Construct Complex Queries**
   Combine multiple operators and text terms to create complex queries that find exactly what you need.

   **Examples:**
   * Find all open items assigned to you in the "website" project:
     `is:open assignee:me project:website`
   * Find all closed bugs:
     `is:closed bug`
   * Find open items assigned to Jules mentioning "login":
     `is:open assignee:jules login`

## Expected result
You should be able to press `Cmd+K` to open the search dialog and successfully enter operators like `is:open` and `assignee:me` to filter your search results accurately.
