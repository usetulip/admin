export type PipelineStepStatus = "pending" | "active" | "completed";

export type PipelineStep = {
  id: string;
  label: string;
  status: PipelineStepStatus;
};

export type ProjectStatus =
  | "pending_approval"
  | "processing"
  | "delivered";

export type Project = {
  id: string;
  userId: string;
  userName: string | null;
  userEmail: string | null;
  status: ProjectStatus;
  primaryColor: string;
  secondaryColor: string;
  backgroundColor: string;
  layoutType: string;
  features: string[];
  pipelineSteps: PipelineStep[];
  processingStartedAt: string | null;
  deliveredAt: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  figmaFileUrl: string | null;
  figmaFileName: string | null;
  githubUrl: string | null;
  zipFileUrl: string | null;
  zipFileName: string | null;
  s3Bucket: string | null;
  createdAt: string;
  updatedAt: string;
  secondsRemaining: number;
  processingDeadline: string | null;
};

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

async function apiFetch<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      ...(options?.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      ...options?.headers,
    },
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error ?? "Request failed");
  }

  return data as T;
}

export async function listProjects() {
  return apiFetch<{ projects: Project[] }>("/api/admin/projects");
}

export async function getProject(id: string) {
  return apiFetch<{ project: Project }>(`/api/admin/projects/${id}`);
}

export async function approveProject(id: string) {
  return apiFetch<{ project: Project }>(`/api/admin/projects/${id}/approve`, {
    method: "POST",
  });
}

export async function updatePipeline(
  id: string,
  pipelineSteps: PipelineStep[],
) {
  return apiFetch<{ project: Project }>(`/api/admin/projects/${id}/pipeline`, {
    method: "PATCH",
    body: JSON.stringify({ pipelineSteps }),
  });
}

export async function updateAssets(
  id: string,
  assets: { githubUrl?: string | null; s3Bucket?: string | null },
) {
  return apiFetch<{ project: Project }>(`/api/admin/projects/${id}/assets`, {
    method: "PATCH",
    body: JSON.stringify(assets),
  });
}

export async function uploadProjectFile(
  id: string,
  fileType: "figma" | "zip",
  file: File,
) {
  const formData = new FormData();
  formData.append("fileType", fileType);
  formData.append("file", file);

  return apiFetch<{ project: Project }>(`/api/admin/projects/${id}/upload`, {
    method: "POST",
    body: formData,
  });
}

export async function deliverProject(id: string) {
  return apiFetch<{ project: Project }>(`/api/admin/projects/${id}/deliver`, {
    method: "POST",
  });
}

export async function deleteProject(id: string) {
  return apiFetch<{ success: boolean }>(`/api/admin/projects/${id}`, {
    method: "DELETE",
  });
}
