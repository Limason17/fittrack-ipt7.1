// Test-only MinIO bucket bootstrap/teardown helper for Stage 2B2A
// integration tests. Deliberately lives under test/ and is never imported
// by production code (backupRemotePreflight.js explicitly never creates or
// configures a bucket) - only this helper is allowed to call
// CreateBucketCommand/PutBucketVersioningCommand, and only against the
// synthetic local MinIO test service.
const {
    CreateBucketCommand,
    DeleteObjectsCommand,
    HeadBucketCommand,
    ListObjectVersionsCommand,
    PutBucketVersioningCommand
} = require("@aws-sdk/client-s3");

const { createS3Client } = require("../../scripts/backupRemoteStorage");

async function ensureTestBucketReady(remoteConfig) {
    const client = createS3Client(remoteConfig);
    try {
        await client.send(new HeadBucketCommand({ Bucket: remoteConfig.bucket }));
    } catch {
        await client.send(new CreateBucketCommand({ Bucket: remoteConfig.bucket }));
    }
    await client.send(
        new PutBucketVersioningCommand({
            Bucket: remoteConfig.bucket,
            VersioningConfiguration: { Status: "Enabled" }
        })
    );
    return client;
}

// Removes every version (and delete marker) of every object under the
// configured prefix - a thorough wipe so successive test runs never see
// leftover state from a previous run, distinct from the production
// retention-apply path which only ever issues plain DeleteObject calls.
async function purgeTestPrefix(client, remoteConfig) {
    const listPrefix = `${remoteConfig.prefix}/`;
    let keyMarker;
    let versionIdMarker;
    do {
        const page = await client.send(
            new ListObjectVersionsCommand({
                Bucket: remoteConfig.bucket,
                Prefix: listPrefix,
                KeyMarker: keyMarker,
                VersionIdMarker: versionIdMarker
            })
        );
        const objects = [
            ...(page.Versions || []),
            ...(page.DeleteMarkers || [])
        ].map((entry) => ({ Key: entry.Key, VersionId: entry.VersionId }));
        if (objects.length > 0) {
            await client.send(
                new DeleteObjectsCommand({
                    Bucket: remoteConfig.bucket,
                    Delete: { Objects: objects, Quiet: true }
                })
            );
        }
        keyMarker = page.IsTruncated ? page.NextKeyMarker : undefined;
        versionIdMarker = page.IsTruncated ? page.NextVersionIdMarker : undefined;
    } while (keyMarker);
}

module.exports = {
    ensureTestBucketReady,
    purgeTestPrefix
};
