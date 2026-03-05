
  it("appends and lists activities", async () => {
    const repo = await createRepo();
    repo.createSession({ id: "s1", provider: "jules" });

    repo.appendActivity("s1", { description: "act 1", payload: { x: 1 } });
    repo.appendActivity("s1", { description: "act 2" });

    const activities = repo.listAllActivities("s1");
    expect(activities).toHaveLength(2);
    expect(activities[1].description).toBe("act 1");
    expect((activities[1] as any).x).toBe(1);

    const paged = repo.listActivities({ session_id: "s1", page_size: 1 });
    expect(paged.activities).toHaveLength(1);
    expect(paged.nextPageToken).toBe("1");
  });

  it("lists sessions", async () => {
    const repo = await createRepo();
    repo.createSession({ id: "s1", provider: "jules", title: "T1" });
