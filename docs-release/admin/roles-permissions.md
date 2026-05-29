# Roles and Permissions

This page explains the different roles available within the application and their respective capabilities. Understanding these roles helps you manage access and maintain security across your workspace and projects.

## Workspace Roles

The following core roles define the default permissions a user has across the entire workspace:

* **Owner**: The creator of the workspace or a user who has been transferred ownership. Owners have full and unrestricted access to all workspace settings, billing, projects, and member management.
* **Admin**: Administrative users who assist the Owner in managing the workspace. Admins can manage members, configure workspace settings, and oversee most projects, but they cannot delete the workspace or transfer ownership.
* **Member**: Regular users who actively contribute to projects within the workspace. Members can create projects, complete tasks, and collaborate, but they cannot access billing or workspace-level administrative settings.
* **Viewer**: Read-only users who can view projects and tasks but cannot make changes, add comments, or modify any data. This role is ideal for external stakeholders or users who only need to monitor progress.

## Permissions Matrix

The table below outlines the specific capabilities granted to each role at the workspace level.

| Capability | Owner | Admin | Member | Viewer |
| :--- | :---: | :---: | :---: | :---: |
| View projects and tasks | ✅ | ✅ | ✅ | ✅ |
| Add comments | ✅ | ✅ | ✅ | ❌ |
| Edit tasks and projects | ✅ | ✅ | ✅ | ❌ |
| Create new projects | ✅ | ✅ | ✅ | ❌ |
| Invite Members and Viewers | ✅ | ✅ | ❌ | ❌ |
| Manage billing and subscriptions | ✅ | ❌ | ❌ | ❌ |
| Delete the workspace | ✅ | ❌ | ❌ | ❌ |
| Transfer workspace ownership | ✅ | ❌ | ❌ | ❌ |

## Project-Level Overrides

While workspace roles define default access, **project-level permissions override workspace defaults**.

When a user is added to a specific project with a different role, the project-level role takes precedence for that specific project.

* **Upgrading Access**: A user might have the **Viewer** role at the workspace level, meaning they default to read-only access across the workspace. However, if they are explicitly invited to "Project Alpha" as a **Member**, they will have full contribution rights (editing tasks, adding comments) only within "Project Alpha".
* **Restricting Access**: Conversely, a workspace **Member** could be added to a highly sensitive project as a **Viewer**, restricting their ability to edit anything within that specific project, even though they can edit tasks elsewhere in the workspace.

This inheritance model ensures that you can maintain broad workspace security while allowing flexible, granular access control for individual projects.
