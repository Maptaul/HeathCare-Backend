export interface CreateSchedulePayload {
  startDateTime: Date;
  endDateTime: Date;
  meetingLink: string;
}
export interface IUpdateSchedulePayload {
  startDateTime?: Date;
  endDateTime?: Date;
  meetingLink?: string;
}
