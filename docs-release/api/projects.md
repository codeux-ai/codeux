# Projects API

The Projects API allows you to manage projects programmatically.

## Endpoints

### List Projects

Retrieve a list of all available projects.

**GET** `/api/projects`

**Response Example**
```json
{
  "projects": [
    {
      "id": "prj_123",
      "slug": "my-project",
      "name": "My Project",
      "baseDir": "/var/projects/my-project",
      "repoUrl": "https://github.com/example/my-project",
      "sourceType": "git",
      "sourceRef": "main",
      "gitProvider": "github",
      "gitHostDomain": "github.com",
      "defaultBranch": "main",
      "featureBranchPrefix": "feat-",
      "status": "running",
      "sprintsCount": 5,
      "openTasks": 12,
      "completedTasks": 34,
      "isRunning": true,
      "settingsOverrides": {},
      "agentBindings": [],
      "createdAt": "2023-10-01T12:00:00Z",
      "updatedAt": "2023-10-05T15:30:00Z"
    }
  ],
  "selectedProjectId": "prj_123"
}
```

### Get Project

Retrieve a single project by its ID.

**GET** `/api/projects/:projectId`

**Response Example**
```json
{
  "id": "prj_123",
  "slug": "my-project",
  "name": "My Project",
  "baseDir": "/var/projects/my-project",
  "repoUrl": "https://github.com/example/my-project",
  "sourceType": "git",
  "sourceRef": "main",
  "gitProvider": "github",
  "gitHostDomain": "github.com",
  "defaultBranch": "main",
  "featureBranchPrefix": "feat-",
  "status": "running",
  "sprintsCount": 5,
  "openTasks": 12,
  "completedTasks": 34,
  "isRunning": true,
  "settingsOverrides": {},
  "agentBindings": [],
  "createdAt": "2023-10-01T12:00:00Z",
  "updatedAt": "2023-10-05T15:30:00Z"
}
```

**Error Codes**
- `404 Not Found`: Project not found.

### Create Project

Create a new project.

**POST** `/api/projects`

**Request Body Parameters**

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | The name of the project. |
| `sourceType` | string | Yes | The source type (`local` or `git`). |
| `sourceRef` | string | Yes | The source reference (e.g., path or URL). |
| `cloneDir` | string | No | Optional directory to clone to. |
| `setup` | object | No | Project setup options. |

**Request Example**
```json
{
  "name": "New Website",
  "sourceType": "git",
  "sourceRef": "https://github.com/example/website"
}
```

**Response Example**
```json
{
  "id": "prj_124",
  "slug": "new-website",
  "name": "New Website",
  "baseDir": "/var/projects/new-website",
  "repoUrl": "https://github.com/example/website",
  "sourceType": "git",
  "sourceRef": "main",
  "gitProvider": "github",
  "gitHostDomain": "github.com",
  "defaultBranch": null,
  "featureBranchPrefix": null,
  "status": "idle",
  "sprintsCount": 0,
  "openTasks": 0,
  "completedTasks": 0,
  "isRunning": false,
  "settingsOverrides": {},
  "agentBindings": [],
  "createdAt": "2023-11-01T10:00:00Z",
  "updatedAt": "2023-11-01T10:00:00Z"
}
```

**Error Codes**
- `400 Bad Request`: Failed to create project (e.g., invalid input).

### Update Project

Update an existing project. Note: We use `PATCH` for updates.

**PATCH** `/api/projects/:projectId`

**Request Body Parameters**

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | No | The name of the project. |
| `sourceType` | string | No | The source type (`local` or `git`). |
| `sourceRef` | string | No | The source reference. |
| `baseDir` | string | No | Base directory. |
| `defaultBranch` | string | No | The default branch name. |
| `featureBranchPrefix` | string | No | Prefix for feature branches. |
| `status` | string | No | The project status (`running`, `failed`, `intervention`, `idle`). |

**Request Example**
```json
{
  "status": "running",
  "defaultBranch": "develop"
}
```

**Response Example**
```json
{
  "id": "prj_124",
  "slug": "new-website",
  "name": "New Website",
  "baseDir": "/var/projects/new-website",
  "repoUrl": "https://github.com/example/website",
  "sourceType": "git",
  "sourceRef": "main",
  "gitProvider": "github",
  "gitHostDomain": "github.com",
  "defaultBranch": "develop",
  "featureBranchPrefix": null,
  "status": "running",
  "sprintsCount": 0,
  "openTasks": 0,
  "completedTasks": 0,
  "isRunning": true,
  "settingsOverrides": {},
  "agentBindings": [],
  "createdAt": "2023-11-01T10:00:00Z",
  "updatedAt": "2023-11-01T10:05:00Z"
}
```

**Error Codes**
- `400 Bad Request`: Failed to update project.

### Delete Project

Delete a project. Note: We use `DELETE` for removal.

**DELETE** `/api/projects/:projectId`

**Response Example**
```json
{
  "ok": true
}
```

**Error Codes**
- `400 Bad Request`: Failed to delete project.
