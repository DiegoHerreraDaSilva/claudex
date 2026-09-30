export interface Checkpoint {
  id: string;
  missionId: string;
  index: number;
  commit: string;
  files: string[];
  createdAt: number;
}
