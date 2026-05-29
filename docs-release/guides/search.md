# Search Guide

## Overview
Learn how to quickly navigate the app using global search. By the end of this guide, you will be able to access the search menu, use search operators to filter results, and write complex queries to find exactly what you need.

::: info
Global search is the fastest way to find Workspaces, Projects, and Tasks without manual navigation.
:::

## Prerequisites
* You must be logged into the application.

## Steps

1. **Open Global Search**
   Press the keyboard shortcut `Cmd+K` (or `Ctrl+K` on Windows) from anywhere in the application to open the search modal.

2. **Use Search Operators**
   Narrow down your search results by typing a search operator directly into the search bar, followed by a colon (`:`) and your filter value.

   | Operator | Description | Example |
   | :--- | :--- | :--- |
   | `is:` | Filter by status | `is:open`, `is:done` |
   | `assignee:` | Filter by assigned user | `assignee:me`, `assignee:alice` |
   | `type:` | Filter by item type | `type:task`, `type:project` |

3. **Write Complex Queries**
   You can combine multiple operators and regular text to create powerful searches.

   * Find all open tasks assigned to you: `is:open assignee:me`
   * Find high priority bugs: `type:bug priority:high`
   * Search for a specific project name while filtering by status: `Apollo 11 is:active`

::: tip
The search results update instantly as you type. Use the up and down arrow keys to navigate the results and press `Enter` to select an item.
:::

## Expected Result
You should see the global search modal open when pressing `Cmd+K`, and the results should correctly filter when you apply search operators or complex queries.
