export type Update = {
  update_id: number;
  message?: Message;
  callback_query?: CallbackQuery;
};

export type Message = {
  message_id: number;
  from?: {
    id: number;
    is_bot: boolean;
    first_name?: string;
    last_name?: string;
    username?: string;
  };
  chat: {
    id: number;
    type: string;
  };
  date: number;
  text?: string;
  photo?: Array<{ file_id: string; file_unique_id: string; file_size?: number; width?: number; height?: number }>;
  document?: {
    file_id: string;
    file_unique_id: string;
    file_size?: number;
    file_name?: string;
    mime_type?: string;
  };
};

export type CallbackQuery = {
  id: string;
  from: {
    id: number;
    is_bot: boolean;
    first_name?: string;
    last_name?: string;
    username?: string;
  };
  message?: Message;
  data?: string;
};

export type TelegramFileInfo = {
  ok: boolean;
  result: {
    file_id: string;
    file_unique_id: string;
    file_size?: number;
    file_path?: string;
  };
};
