export default {
  fetch(): Response {
    return new Response("zenguy api", { status: 200 });
  },
} satisfies ExportedHandler;
