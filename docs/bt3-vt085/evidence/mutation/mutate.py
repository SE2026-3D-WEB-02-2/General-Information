import sys
SVC='apps/api/src/modules/annotations/domain/annotation.service.ts'
WEB='apps/web/src/adapters/http-annotation-api.ts'
M = {
 # M1: restore swallows the storage exception and reports success with the (unsaved) snapshot
 'M1': (SVC, """    try {
      await this.repo.insert(restored, audit);
    } catch (error) {
      await this.tombstones.save(claimed);
      return {
        status: 'RESTORE_FAILED',
        message: `Restore could not be saved (${(error as Error).message}). Nothing was changed; retry before the undo window closes.`,
      };
    }""", """    try {
      await this.repo.insert(restored, audit);
    } catch {
      // MUTANT M1: swallow and pretend success
      return { status: 'OK', snapshot: this.toDomainSnapshot(restored) };
    }"""),
 # M2: restore swallows the exception and returns a default/empty annotation
 'M2': (SVC, """    try {
      await this.repo.insert(restored, audit);
    } catch (error) {
      await this.tombstones.save(claimed);
      return {
        status: 'RESTORE_FAILED',
        message: `Restore could not be saved (${(error as Error).message}). Nothing was changed; retry before the undo window closes.`,
      };
    }""", """    try {
      await this.repo.insert(restored, audit);
    } catch {
      // MUTANT M2: swallow and return default data
      return { status: 'OK', snapshot: this.toDomainSnapshot({ ...restored, status: 'OPEN', version: 1, comments: [], camera_state: undefined }) };
    }"""),
 # M3: web consumer swallows every error and returns a default snapshot
 'M3': (WEB, """    } catch (error) {
      if (error instanceof ApiClientError) {
        return { ok: false, statusCode: error.statusCode, errorCode: error.detail.errorCode, message: error.detail.message };
      }
      throw error;
    }
  }

  exportAnnotations""", """    } catch {
      // MUTANT M3: swallow and return a default annotation
      return { ok: true, data: { id, modelId: '', authorId: '', status: 'OPEN', version: 1, position: [0, 0, 0], normal: [0, 1, 0], cameraState: { position: [0, 0, 5], target: [0, 0, 0] }, comments: [], updatedAt: new Date(0).toISOString() } };
    }
  }

  exportAnnotations"""),
 # M4: delete swallows a tombstone-store failure and still hands out undo info
 'M4': (SVC, """      try {
        await this.tombstones.save(tombstone);
      } catch (error) {
        // Never leave a delete without its undo: put the row back and surface the error.
        await this.repo.insert(current, this.buildOperationalLog(id, actorId, 'CREATED', current.version, current.version));
        throw error;
      }""", """      try {
        await this.tombstones.save(tombstone);
      } catch {
        // MUTANT M4: swallow; the caller still receives a (now useless) undo token
      }"""),
 # M5 (extra, not the VT-085 mutation type): drop compare-and-delete, delete whatever version is there
 'M5': (SVC, "const deleted = await this.repo.deleteIfVersion(id, current.version, deleteAudit);",
              "const deleted = await this.repo.deleteById(id, deleteAudit); // MUTANT M5: no CAS"),
}
key=sys.argv[1]; path,old,new=M[key]
s=open(path).read(); assert s.count(old)==1, key; open(path,'w').write(s.replace(old,new)); print('applied',key,'to',path)
