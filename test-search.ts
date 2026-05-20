import { useSearch } from "@tanstack/react-router";

function Test() {
  const search = useSearch({ strict: false });
  console.log(search);
}
