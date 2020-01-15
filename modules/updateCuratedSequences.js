function syncCurated() {
	glue.log("INFO", "Synchronizing source "+source.name+" with NCBI...");
	var syncResults;
	glue.inMode("module/"+modules.ncbiImporter, function() {
		syncResults = glue.tableToObjects(glue.command(["sync", "--detailed"]));
		glue.log("FINEST", "NCBI syncronization report", syncResults);
		glue.log("INFO", "Synchronization complete");
	});
	glue.log("INFO", "Deleting surplus sequence files");
	var deleted = 0;
	_.each(syncResults, function(syncResult) {
		if(syncResult.status == "SURPLUS") {
			glue.command(["file-util", "delete-file", "sources/ncbi-curated/"+syncResult.sequenceID+".xml"]);
			deleted++;
		}
	});
	glue.log("INFO", "Deleted "+deleted+" surplus sequence files");
	glue.log("INFO", "Exporting incoming sequences to file system...");
	glue.command(["export", "source", "--whereClause", "ncbi_incoming = null", "--parentDir", source.path, source.name]);
}

function placeCuratedAll() {
	glue.log("INFO", "Deleting files in placement path "+placement.path);
	var placementPathFiles = glue.tableToObjects(glue.command(["file-util", "list-files", "--directory", placement.path]));
	_.each(placementPathFiles, function(placementPathFile) {
		if(placementPathFile.fileName.indexOf("xml") >= 0) {
			glue.command(["file-util", "delete-file", placement.path+"/"+placementPathFile.fileName]);
		}
	});
	glue.log("INFO", "Deleted "+placementPathFiles.length+" files");
	var fileSuffix = 1;
	var whereClause = "source.name = 'ncbi-curated'";
	placeCurated(whereClause, fileSuffix);
}

// sets ncbi-incoming to true for all ncbi-curated sequences.
// sets ncbi-incoming to false for all ncbi-curated sequences mentioned in current placement files.
// generates placements for incoming sequences.
function placeCuratedIncremental() {
	glue.logInfo("Setting ncbi_incoming to true for all ncbi-curated");
	glue.command(["multi-set", "field", "sequence", "-w", "source.name = 'ncbi-curated'", "ncbi_incoming", "true", "-b", "2500"]);
	glue.command(["new-context"]);
	var placementPathFiles = glue.tableToObjects(glue.command(["file-util", "list-files", "--directory", placement.path]));
	var processed = 0;
	_.each(placementPathFiles, function(placementPathFile) {
		if(placementPathFile.fileName.indexOf("xml") >= 0) {
			var queries;
			glue.inMode("module/hcvMaxLikelihoodPlacer", function() {
				queries = glue.getTableColumn(glue.command(["list", "query", "-i", placement.path+"/"+placementPathFile.fileName]), "queryName");
			});
			glue.logInfo("Setting ncbi_incoming to false for "+queries.length+" sequences from placement file "+placement.path+"/"+placementPathFile.fileName);
			var inExpr = "(";
			for(var i = 0; i < queries.length; i++) {
				if(i > 0) {
					inExpr += ",";
				}
				inExpr += "'"+queries[i].split("/")[1]+"'";
			}
			inExpr += ")";
			glue.command(["multi-set", "field", "sequence", "-w", "source.name = 'ncbi-curated' and sequenceID in "+inExpr, "ncbi_incoming", "false"]);
			processed += queries.length;
			if(processed % 10000 == 0) {
				glue.command(["new-context"]);
			}
		}
	});
	glue.logInfo("Generating placement files for any ncbi-curated sequences where ncbi_incoming is true");
	placeCuratedIncoming();
}



function pad(num, size) {
    var s = num+"";
    while (s.length < size) {
    	s = "0" + s;
    }
    return s;
}

function placeCuratedIncoming() {
	var placementPathFiles = glue.tableToObjects(glue.command(["file-util", "list-files", "--directory", placement.path]));
	var placementFileNames = _.map(placementPathFiles, function(placementPathFile) {return placementPathFile.fileName;});
	var fileSuffix = 1;
	while(true) {
		fileSuffixString = pad(fileSuffix, 6);
		if(_.contains(placementFileNames, placement.prefix + fileSuffixString + ".xml")) {
			fileSuffix++;
		} else {
			break;
		}
	}
	var whereClause = "source.name = 'ncbi-curated' and ncbi_incoming = true";
	placeCurated(whereClause, fileSuffix);
}

function placeCurated(whereClause, fileSuffix) {
	glue.log("INFO", "Counting sequences where "+whereClause);
	var numSequences = glue.command(["count", "sequence", "--whereClause", whereClause]).countResult.count;
	glue.log("INFO", "Found "+numSequences+" sequences where "+whereClause);
	var batchSize = 50;
	var offset = 0;
	while(offset < numSequences) {
		glue.log("INFO", "Placing sequences starting at offset "+offset);
		try {
			placeBatch(whereClause, offset, batchSize, fileSuffix);
			offset += batchSize;
			fileSuffix++;
		} catch(err) {
			if(err.name == "GlueError" && 
					err.exClassSimpleName == "RaxmlEpaException" && 
					err.code == "RAXML_EPA_EXIT_138_ASSERTION_ERROR") {
				// rare RaxmlEPA bug. Work around by splitting the batch in two
				// if it still fails then don't catch the exxception.
				var halfBatchSize = batchSize / 2;
				placeBatch(whereClause, offset, halfBatchSize, fileSuffix);
				offset += halfBatchSize;
				fileSuffix++;
				placeBatch(whereClause, offset, halfBatchSize, fileSuffix);
				offset += halfBatchSize;
				fileSuffix++;
			}
		}
	}
}

function placeBatch(whereClause, offset, batchSize, fileSuffix) {
	glue.inMode("module/"+modules.placer, function() {
		var fileSuffixString = pad(fileSuffix, 6);
		var outputFile = placement.path + "/" + placement.prefix + fileSuffixString + ".xml";
		glue.command(["place", "sequence", 
			"--whereClause", whereClause,
			"--pageSize", batchSize, "--fetchLimit", batchSize, "--fetchOffset", offset, 
			"--outputFile", outputFile]);
	});
}

// genotype and add to alignment tree.
function genotypeCurated() {
	glue.command(["multi-delete", "alignment_member", "-w", "sequence.source.name = 'ncbi-curated'"]);
	var placementPathFiles = glue.tableToObjects(glue.command(["file-util", "list-files", "--directory", placement.path]));
	var alignmentsToRecompute = {};
	_.each(placementPathFiles, function(placementPathFile) {
		if(placementPathFile.fileName.indexOf("xml") >= 0) {
			glue.log("INFO", "Computing genotype results for placement file "+placementPathFile.fileName);
			var batchGenotyperResults;
			glue.inMode("module/"+modules.genotyper, function() {
				batchGenotyperResults = glue.command(
						["genotype", "placer-result", 
						 "--fileName", placement.path+"/"+placementPathFile.fileName, 
						 "--detailLevel", "HIGH"], 
						{convertTableToObjects:true});
			});
			glue.log("INFO", "Assigning genotype metadata for "+batchGenotyperResults.length+" genotyping results from placement file "+placementPathFile.fileName);
			var batchSize = 500;
			var numUpdates = 0;
			_.each(batchGenotyperResults, function(genotyperResult) {
				var speciesAlmt;
				var genotypeAlmt;
				var subtypeAlmt;
				glue.inMode("sequence/"+genotyperResult.queryName, function() {
					speciesAlmt = genotyperResult.speciesFinalClade;
					genotypeAlmt = genotyperResult.genotypeFinalClade;
					if(genotypeAlmt) {
						var gtRegex = /AL_([0-9]+)/;
						var gtMatch = gtRegex.exec(genotypeAlmt);
						if(gtMatch) {
							glue.command(["set", "field", "--noCommit", "genotype", gtMatch[1]]);
						}
					}
					subtypeAlmt = genotyperResult.subtypeFinalClade;
					if(subtypeAlmt) {
						var stRegex = /AL_(.*)/;
						var stMatch = stRegex.exec(subtypeAlmt);
						if(stMatch) {
							glue.command(["set", "field", "--noCommit", "subtype", stMatch[1]]);
						}
					}
				});
				var almtTarget;
				if(subtypeAlmt) {
					almtTarget = subtypeAlmt;
				} else if(genotypeAlmt) {
					almtTarget = genotypeAlmt;
				} else if(speciesAlmt) {
					almtTarget = speciesAlmt;
				}
				var bits = genotyperResult.queryName.split("/");
				var sourceName = bits[0];
				var sequenceID = bits[1];
				if(almtTarget != null) {
					glue.inMode("alignment/"+almtTarget, function() {
						var whereClause = "source.name = '"+sourceName+"' and sequenceID = '"+sequenceID+"' and "+
					      "( gb_host = 'Homo sapiens' or gb_host = null ) and "+
					      "( gb_lab_construct = false ) and "+
					      "( gb_recombinant = false )";
						glue.logInfo("whereClause", whereClause);
						glue.command(["add", "member", "-w", whereClause]);
					});
					alignmentsToRecompute[almtTarget] = "yes";
				}
				
				if(numUpdates % batchSize == 0) {
					glue.command("commit");
					glue.command("new-context");
					glue.log("FINE", "Metadata assigned / member added for "+numUpdates+" sequences.");
				}
				numUpdates++;
			});
			glue.command("commit");
			glue.command("new-context");
			glue.log("FINE", "Metadata assigned / member added for "+numUpdates+" sequences.");
			_.each(_.keys(alignmentsToRecompute), function(almtName) {
				glue.log("FINE", "Adding homology for alignment "+almtName);
				glue.command(["compute", "alignment", almtName, "hcvCompoundAligner", "-w", "sequence.source.name = 'ncbi-curated'"]);
			});
		}
	});
	
}