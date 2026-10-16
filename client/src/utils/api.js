import axios from "axios";
import dayjs from "dayjs";
import { toast } from "react-toastify";
import {
  NotLoggedInError,
  SessionExpiredError,
  getAccessToken,
  handleSessionExpired,
} from "./auth";

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "http://localhost:8000/api",
});

// Only these calls carry a token; public listing and detail calls never do.
const needsToken = ({ url = "", method = "get" }) =>
  url.startsWith("/user/") ||
  (method.toLowerCase() === "post" && url === "/residency/create");

api.interceptors.request.use(async (config) => {
  if (needsToken(config)) {
    // Throws if there is no session or renewal fails, so the request is not sent.
    const token = await getAccessToken();
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error instanceof NotLoggedInError) {
      toast.info("Please log in first");
    } else if (error instanceof SessionExpiredError || error.response?.status === 401) {
      toast.error("Your session has expired. Please log in again.");
      handleSessionExpired();
    } else if (error.response?.status === 403) {
      toast.error(error.response.data?.message || "You are not allowed to do this");
    }
    return Promise.reject(error);
  }
);

// Creates or returns the caller's own profile; only name and image are sent.
export const registerUser = async ({ name, image }) => {
  const response = await api.post("/user/register", { name, image });
  return response.data.user;
};

export const getAllProperties = async () => {
  try {
    const response = await api.get("/residency/allresd", {
      timeout: 10 * 1000,
    });

    if (response.status === 400 || response.status === 500) {
      throw response.data;
    }
    return response.data;
  } catch (error) {
    toast.error("Something went wrong");
    throw error;
  }
};

export const getProperty = async (id) => {
  try {
    const response = await api.get(`/residency/${id}`, {
      timeout: 10 * 1000,
    });

    if (response.status === 400 || response.status === 500) {
      throw response.data;
    }
    return response.data;
  } catch (error) {
    toast.error("Something went wrong");
    throw error;
  }
};
