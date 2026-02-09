
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, MoreVertical, Folder, Share2, Edit2, Trash2, X, Upload } from 'lucide-react';
import { useFileDrop } from '../hooks/useFileDrop';
import { useToast } from '../hooks/useToast';
import { UploadProgress } from '../components/UploadProgress';
import { ToastContainer } from '../components/ToastContainer';
import { FileUploadProgress } from '../types';
import { validateFile, uploadFilesWithProgress, formatFileSize, checkDuplicates } from '../utils/uploadUtils';
import { api } from '../services/api';
import { ApiResponse, Bucket } from '../types';
import bucketIcon from '../assets/bucket-icon.png';
import noBucket from '../assets/no-bucket.svg';

const Dashboard: React.FC = () => {
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingBucket, setEditingBucket] = useState<Bucket | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [uploads, setUploads] = useState<FileUploadProgress[]>([]);
  const [uploadingBucketId, setUploadingBucketId] = useState<string | null>(null);
  const { showToast } = useToast();
  const navigate = useNavigate();

  const fetchBuckets = async () => {
    try {
      const res = await api.getBuckets();
      if (res.ok) {
        const apiResponse: ApiResponse<Bucket[]> = await res.json();
        setBuckets(apiResponse.result || []);
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    fetchBuckets();
  }, []);

  // Navigation guard - prevent leaving page during uploads
  useEffect(() => {
    const hasPendingUploads = uploads.some((u) => u.status === 'uploading' || u.status === 'pending');

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasPendingUploads) {
        e.preventDefault();
        e.returnValue = 'Uploads in progress. Are you sure you want to leave?';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [uploads]);

  // Offline/online detection
  useEffect(() => {
    const handleOffline = () => {
      if (uploads.some((u) => u.status === 'uploading' || u.status === 'pending')) {
        showToast('error', 'You are offline. Uploads have been paused.');
      }
    };

    const handleOnline = () => {
      if (uploads.some((u) => u.status === 'pending')) {
        showToast('success', 'Back online. You can retry your uploads.');
      }
    };

    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);

    return () => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  }, [uploads, showToast]);

  const handleCreateOrUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (editingBucket) {
        await api.updateBucket(editingBucket.bucketId, { name, description });
      } else {
        await api.createBucket({ name, description });
      }
      setIsModalOpen(false);
      setEditingBucket(null);
      setName('');
      setDescription('');
      fetchBuckets();
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (window.confirm('Are you sure you want to delete this bucket? This action cannot be undone.')) {
      try {
        await api.deleteBucket(id);
        fetchBuckets();
      } catch (e) {
        console.error(e);
      }
    }
  };

  const handleShare = async (id: string) => {
    try {
      const res = await api.shareBucket(id);
      if (res.ok) {
        const data = await res.json();
        setShareLink(data.shareLink);
      }
    } catch (e) {
      console.error(e);
    }
  };

  /**
   * Handles file drop events on bucket cards
   * Validates files, checks for duplicates, creates upload progress entries, and uploads files to the specified bucket
   * @param bucketId - The ID of the bucket to upload files to
   * @param files - Array of files to upload
   */
  const handleFileDrop = async (bucketId: string, files: File[]) => {
    // Get bucket for duplicate checking
    const bucket = buckets.find((b) => b.bucketId === bucketId);
    const existingFiles = bucket?.files || [];

    // Check for duplicates
    const duplicates = checkDuplicates(files, existingFiles);
    if (duplicates.length > 0) {
      const duplicateNames = duplicates.map((f) => f.name).join(', ');
      showToast('error', `Files already exist: ${duplicateNames}`);
      return;
    }

    // Validate files
    const validationErrors: string[] = [];
    const validFiles = files.filter((file) => {
      const error = validateFile(file);
      if (error) {
        validationErrors.push(error);
        return false;
      }
      return true;
    });

    // Show validation errors
    validationErrors.forEach((error) => {
      showToast('error', error);
    });

    if (validFiles.length === 0) {
      return;
    }

    // Create upload progress entries
    const newUploads: FileUploadProgress[] = validFiles.map((file) => ({
      id: crypto.randomUUID(),
      file,
      status: 'pending',
      progress: 0,
    }));

    setUploads((prev) => [...prev, ...newUploads]);
    setUploadingBucketId(bucketId);

    // Get bucket name for toasts
    const bucket = buckets.find((b) => b.bucketId === bucketId);
    const bucketName = bucket?.name || bucketId;

    // Map file to upload ID
    const fileToIdMap = new Map<File, string>();
    newUploads.forEach((upload) => {
      fileToIdMap.set(upload.file, upload.id);
    });

    // Upload files
    await uploadFilesWithProgress(
      validFiles,
      bucketId,
      (id, progress, status, error) => {
        setUploads((prev) =>
          prev.map((u) =>
            u.id === id ? { ...u, progress, status, error } : u
          )
        );
      },
      (file) => fileToIdMap.get(file) || ''
    );

    // Show success/error toasts
    const successful = newUploads.filter((u) => u.status === 'success');
    const failed = newUploads.filter((u) => u.status === 'error');

    if (successful.length > 0) {
      showToast('success', `Uploaded ${successful.length} file${successful.length > 1 ? 's' : ''} to ${bucketName}`);
    }

    if (failed.length > 0) {
      failed.forEach((u) => {
        if (u.error) {
          showToast('error', u.error);
        }
      });
    }

    // Refresh bucket data
    fetchBuckets();
    setUploadingBucketId(null);
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-2xl font-bold text-black">Your Buckets</h1>
          <p className="text-gray-600">Manage your cloud storage spaces</p>
        </div>
        <button
          onClick={() => {
            setEditingBucket(null);
            setName('');
            setDescription('');
            setIsModalOpen(true);
          }}
          className="flex items-center gap-2 bg-[#028546] text-white px-4 py-2 rounded-lg font-semibold hover:bg-[#00D65A] transition-colors"
        >
          <Plus className="w-5 h-5" />
          Create Bucket
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {buckets.map((bucket) => {
          const { isDragging, dragProps } = useFileDrop({
            onDrop: (files) => handleFileDrop(bucket.bucketId, files),
            disabled: uploadingBucketId !== null,
          });

          return (
            <div
              key={bucket.bucketId}
              {...dragProps}
              className={`
                bg-white rounded-xl p-6 hover:shadow-md transition-all relative group cursor-pointer
                ${isDragging
                  ? 'border-2 border-dashed border-[#028546] bg-green-50'
                  : 'border border-gray-200'}
                ${uploadingBucketId === bucket.bucketId ? 'ring-2 ring-[#028546] ring-opacity-50' : ''}
              `}
              onClick={() => navigate(`/bucket/${bucket.bucketId}`)}
              role="button"
              tabIndex={0}
              aria-label={`Bucket ${bucket.name}, click to view or drag files to upload`}
            >
              {/* Drag overlay */}
              {isDragging && (
                <div className="absolute inset-0 bg-[#028546] bg-opacity-10 rounded-xl flex items-center justify-center z-10">
                  <div className="bg-white rounded-lg p-4 shadow-lg flex flex-col items-center">
                    <Upload className="w-8 h-8 text-[#028546] mb-2" />
                    <span className="font-semibold text-[#028546]">Drop files to upload</span>
                  </div>
                </div>
              )}

              {/* Upload indicator */}
              {uploadingBucketId === bucket.bucketId && uploads.some(u =>
                u.status === 'pending' || u.status === 'uploading'
              ) && (
                <div className="absolute top-2 right-2">
                  <div className="flex items-center gap-1 bg-[#028546] text-white text-xs px-2 py-1 rounded-full">
                    <div className="animate-spin w-3 h-3 border-2 border-white border-t-transparent rounded-full" />
                    <span>Uploading...</span>
                  </div>
                </div>
              )}

              <div className="flex justify-between items-start mb-4">
                <div>
                  <img src={bucketIcon} alt="Bucket Icon" className="w-10 h-10" />
                </div>
                <div className="relative">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setActiveMenu(activeMenu === bucket.bucketId ? null : bucket.bucketId);
                    }}
                    className="p-1 hover:bg-gray-100 rounded-md transition-colors"
                    aria-label="Open bucket menu"
                  >
                    <MoreVertical className="w-5 h-5 text-gray-400" />
                  </button>
                  {activeMenu === bucket.bucketId && (
                    <div className="absolute right-0 mt-2 w-48 bg-white border border-gray-200 rounded-lg shadow-lg z-10 py-1">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingBucket(bucket);
                          setName(bucket.name);
                          setDescription(bucket.description || '');
                          setIsModalOpen(true);
                          setActiveMenu(null);
                        }}
                        className="flex items-center gap-2 w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                      >
                        <Edit2 className="w-4 h-4" /> Edit Metadata
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleShare(bucket.bucketId);
                          setActiveMenu(null);
                        }}
                        className="flex items-center gap-2 w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                      >
                        <Share2 className="w-4 h-4" /> Share Link
                      </button>
                      <div className="border-t border-gray-100 my-1"></div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(bucket.bucketId);
                          setActiveMenu(null);
                        }}
                        className="flex items-center gap-2 w-full px-4 py-2 text-sm text-red-600 hover:bg-red-50"
                      >
                        <Trash2 className="w-4 h-4" /> Delete Bucket
                      </button>
                    </div>
                  )}
                </div>
              </div>
              <h3 className="font-bold text-lg text-black mb-1 truncate">{bucket.name}</h3>
              <p className="text-gray-500 text-sm mb-4 line-clamp-2 min-h-[40px]">
                {bucket.description || 'No description provided.'}
              </p>
              <div className="flex justify-between items-center text-xs text-gray-400">
                <span>{bucket.fileCount} files</span>
                <span>{formatFileSize(bucket.totalSize)}</span>
              </div>
            </div>
          );
        })}

        {buckets.length === 0 && (
          <div className="col-span-full py-20 text-center bg-gray-50 rounded-xl border border-dashed border-gray-300">
            <img src={noBucket} alt="No buckets" className="w-30 h-30 sm:w-32 sm:h-32 md:w-40 md:h-40 mx-auto mb-6" />
            <h3 className="text-lg font-medium text-gray-900">No buckets yet</h3>
            <p className="text-gray-500">Create your first bucket to start uploading files.</p>
          </div>
        )}
      </div>

      {/* Bucket Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-xl w-full max-w-md p-6 shadow-2xl">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold">{editingBucket ? 'Update Bucket' : 'Create Bucket'}</h2>
              <button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-6 h-6" />
              </button>
            </div>
            <form onSubmit={handleCreateOrUpdate} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Bucket Name</label>
                <input
                  type="text"
                  required
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#00ED64] focus:border-transparent outline-none"
                  placeholder="e.g. static-assets"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description (Optional)</label>
                <textarea
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#00ED64] focus:border-transparent outline-none resize-none"
                  rows={3}
                  placeholder="Describe the contents of this bucket..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg font-medium text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 px-4 py-2 bg-[#00ED64] text-black rounded-lg font-bold hover:bg-[#00D65A] disabled:opacity-50"
                >
                  {loading ? 'Processing...' : (editingBucket ? 'Update' : 'Create')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Share Modal */}
      {shareLink && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-xl w-full max-w-md p-6 shadow-2xl">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold">Share Bucket</h2>
              <button onClick={() => setShareLink(null)} className="text-gray-400 hover:text-gray-600">
                <X className="w-6 h-6" />
              </button>
            </div>
            <p className="text-sm text-gray-600 mb-4">Anyone with this link can view the contents of this bucket.</p>
            <div className="flex gap-2">
              <input
                readOnly
                className="flex-1 px-4 py-2 bg-gray-100 border border-gray-300 rounded-lg text-sm text-gray-500 focus:outline-none"
                value={shareLink}
              />
              <button
                onClick={() => {
                  navigator.clipboard.writeText(shareLink);
                  alert('Link copied to clipboard!');
                }}
                className="bg-[#00ED64] text-black px-4 py-2 rounded-lg font-bold text-sm hover:bg-[#00D65A]"
              >
                Copy
              </button>
            </div>
            <button
              onClick={() => setShareLink(null)}
              className="mt-6 w-full py-2 bg-gray-100 text-gray-700 rounded-lg font-medium hover:bg-gray-200"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Toast Notifications */}
      <ToastContainer />

      {/* Upload Progress Panel */}
      {uploads.length > 0 && (
        <UploadProgress
          uploads={uploads}
          onClose={(uploadId) => {
            setUploads((prev) => prev.filter((u) => u.id !== uploadId));
          }}
        />
      )}
    </div>
  );
};

export default Dashboard;
